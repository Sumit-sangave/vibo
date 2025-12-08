import os
import json
import random
import re
import difflib

from django.db import models
from django.core.cache import cache
from rest_framework import status, generics, parsers
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import Track, Playlist, PlaylistItem, Tag
from .serializers import TrackSerializer, PlaylistSerializer

import openai

# OpenAI key is optional – if not set, we fall back to a simple heuristic
OPENAI_KEY = os.getenv('OPENAI_API_KEY')
if OPENAI_KEY:
    openai.api_key = OPENAI_KEY


class UploadTrackView(APIView):
    """
    POST /api/tracks/upload/
    Expects:
      - file: audio file (required)
      - cover: image file (optional)
      - title: string (optional)
      - tags: JSON array OR comma-separated string OR repeated form values
    """
    parser_classes = [parsers.MultiPartParser, parsers.FormParser]

    def post(self, request):
        file = request.data.get('file')
        cover = request.data.get('cover')
        title = request.data.get('title') or (getattr(file, 'name', 'untitled') if file else None)

        # tags can arrive in many shapes:
        # - '["calm","focus"]'
        # - 'calm, focus'
        # - multiple form fields "tags=calm&tags=focus"
        if hasattr(request.data, "getlist"):
            raw_tags = request.data.get('tags') or request.data.getlist('tags')
        else:
            raw_tags = request.data.get('tags')

        if not file:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        # create track with optional cover (Cloudinary storage handles the upload)
        if cover:
            track = Track.objects.create(title=title, file=file, cover=cover)
        else:
            track = Track.objects.create(title=title, file=file)

        # parse tags into a clean list of names
        tag_names = []
        if raw_tags:
            if isinstance(raw_tags, (list, tuple)):
                # e.g. ["calm", "focus"]
                tag_names = [str(t).strip() for t in raw_tags if str(t).strip()]
            else:
                # e.g. JSON string or comma-separated string
                try:
                    parsed = json.loads(raw_tags)
                    if isinstance(parsed, (list, tuple)):
                        tag_names = [str(t).strip() for t in parsed if str(t).strip()]
                    else:
                        tag_names = [p.strip() for p in str(raw_tags).split(',') if p.strip()]
                except Exception:
                    tag_names = [p.strip() for p in str(raw_tags).split(',') if p.strip()]

        # link tags to track
        for name in tag_names:
            tag_obj, _ = Tag.objects.get_or_create(name=name.lower())
            track.tags.add(tag_obj)

        serializer = TrackSerializer(track, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class TrackListView(generics.ListAPIView):
    queryset = Track.objects.all().prefetch_related('tags').order_by('-uploaded_at')
    serializer_class = TrackSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx


class GenerateMixView(APIView):
    """
    POST /api/generate-mix/
    Body: { "prompt": "calm focus" }
    Uses tags / OpenAI (if available) to pick 3–6 tracks.
    Falls back to a random small set when no OpenAI key or error.
    """

    def post(self, request):
        prompt = request.data.get('prompt')
        if not prompt:
            return Response({'error': 'prompt is required'}, status=status.HTTP_400_BAD_REQUEST)

        # extract simple word tokens from prompt to try match with Tag names
        tokens = re.findall(r"\w+", str(prompt).lower())
        tag_qs = Tag.objects.filter(name__in=tokens)

        if tag_qs.exists():
            tracks_qs = Track.objects.filter(tags__in=tag_qs).distinct()
        else:
            tracks_qs = Track.objects.all()

        tracks = list(tracks_qs)
        if not tracks:
            return Response({'error': 'no tracks uploaded'}, status=status.HTTP_400_BAD_REQUEST)

        # context for LLM
        track_ctx = [{'id': t.id, 'title': t.title} for t in tracks]
        playlist_items = []

        def _extract_json_from_text(text: str):
            """Try to extract a JSON array from an LLM response."""
            try:
                return json.loads(text)
            except Exception:
                m = re.search(r"(\[.*\])", text, re.S)
                if m:
                    try:
                        return json.loads(m.group(1))
                    except Exception:
                        return None
                return None

        # Try OpenAI if key is present
        if OPENAI_KEY:
            try:
                system = (
                    "You are a DJ assistant that selects 3-6 tracks from available tracks and returns a JSON list "
                    "of objects with fields {\"id\": <track id>, \"order\": <int>, \"weight\": <float>}."
                    " Only output valid JSON (an array)."
                )
                user_msg = f"Prompt: {prompt}\nAvailable tracks: {json.dumps(track_ctx)}"
                resp = openai.ChatCompletion.create(
                    model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_msg},
                    ],
                    max_tokens=500,
                )
                text = resp.choices[0].message.content
                parsed = _extract_json_from_text(text)
                if isinstance(parsed, list):
                    playlist_items = parsed
            except Exception:
                playlist_items = []

        # Fallback: random small selection
        if not playlist_items:
            chosen = random.sample(tracks, min(5, len(tracks)))
            playlist_items = [
                {
                    'id': t.id,
                    'order': i,
                    'weight': round(random.uniform(0.5, 1.0), 2),
                }
                for i, t in enumerate(chosen)
            ]

        # Create playlist & items
        playlist = Playlist.objects.create(
            name=f"Mix: {prompt}"[:255],
            prompt=prompt,
        )

        selected_ids = []
        for item in playlist_items:
            try:
                track = Track.objects.get(id=item['id'])
            except Track.DoesNotExist:
                continue
            PlaylistItem.objects.create(
                playlist=playlist,
                track=track,
                order=item.get('order', 0),
                weight=item.get('weight', 1.0),
            )
            selected_ids.append(track.id)

        # increment usage counts
        if selected_ids:
            Track.objects.filter(id__in=selected_ids).update(
                times_selected=models.F('times_selected') + 1
            )

        serializer = PlaylistSerializer(playlist, context={'request': request})

        # clear cached "top tracks"
        try:
            cache.delete('top_tracks')
        except Exception:
            pass

        return Response(serializer.data)


class TrackDetailView(APIView):
    """
    DELETE /api/tracks/<id>/
    """

    def delete(self, request, pk):
        try:
            track = Track.objects.get(pk=pk)
        except Track.DoesNotExist:
            return Response({'error': 'not found'}, status=status.HTTP_404_NOT_FOUND)

        # delete file from storage (Cloudinary)
        try:
            track.file.delete(save=False)
        except Exception:
            pass

        track.delete()

        # invalidate cache
        try:
            cache.delete('top_tracks')
        except Exception:
            pass

        return Response(status=status.HTTP_204_NO_CONTENT)


class TopTracksView(APIView):
    """
    GET /api/stats/top-tracks/
    Returns up to 10 tracks ordered by times_selected desc.
    """

    def get(self, request):
        try:
            cached = cache.get('top_tracks')
        except Exception:
            cached = None

        if cached:
            return Response(cached)

        qs = Track.objects.order_by('-times_selected')[:10]
        serializer = TrackSerializer(qs, many=True, context={'request': request})
        data = serializer.data

        try:
            cache.set('top_tracks', data, timeout=60 * 5)
        except Exception:
            pass

        return Response(data)


class TagListView(generics.ListAPIView):
    """
    GET /api/tags/?q=attitude
    Returns list of tag names like ["attitude","attitude_rock", ...]
    """
    queryset = Tag.objects.all().order_by('name')

    def list(self, request, *args, **kwargs):
        q = request.GET.get('q')
        qs = self.queryset
        if q:
            qs = qs.filter(name__icontains=q)
        names = [t.name for t in qs[:50]]
        return Response(names)


class TagSuggestView(APIView):
    """
    POST /api/tags/suggest/
    Body: {"prompt": "chill late night coding"}
    Returns JSON array of suggested tag strings.
    """

    def post(self, request):
        prompt = request.data.get('prompt') or request.data.get('q')
        if not prompt:
            return Response([], status=status.HTTP_200_OK)

        prompt = str(prompt).lower()

        # existing tags in DB
        tag_names = list(Tag.objects.values_list('name', flat=True))

        # candidate tokens
        tokens = re.findall(r"\w+", prompt)
        suggestions = set()

        # fuzzy match existing tags
        for t in tokens:
            matches = difflib.get_close_matches(t, tag_names, n=5, cutoff=0.6)
            for m in matches:
                suggestions.add(m)

        # optionally ask OpenAI for tag ideas
        if OPENAI_KEY:
            try:
                system = (
                    "Extract a short list (3-6) of tag keywords from the user's prompt. "
                    "Return only a JSON array of strings."
                )
                resp = openai.ChatCompletion.create(
                    model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=120,
                )
                text = resp.choices[0].message.content

                parsed = None
                try:
                    parsed = json.loads(text)
                except Exception:
                    m = re.search(r"(\[.*\])", text, re.S)
                    if m:
                        try:
                            parsed = json.loads(m.group(1))
                        except Exception:
                            parsed = None

                if isinstance(parsed, list):
                    for p in parsed:
                        suggestions.add(str(p).lower())
            except Exception:
                pass

        return Response(list(suggestions))
