import os
import json
from django.db.models import Count
from django.db import models
from django.views.decorators.cache import cache_page
from django.core.cache import cache
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics, parsers
from .models import Track, Playlist, PlaylistItem, Tag
from .serializers import TrackSerializer, PlaylistSerializer

import openai

OPENAI_KEY = os.getenv('OPENAI_API_KEY')
if OPENAI_KEY:
    openai.api_key = OPENAI_KEY


class UploadTrackView(APIView):
    parser_classes = [parsers.MultiPartParser, parsers.FormParser]

    def post(self, request):
        file = request.data.get('file')
        cover = request.data.get('cover')
        title = request.data.get('title') or (getattr(file, 'name', 'untitled') if file else None)
        # Accept tags either as JSON list, comma-separated string, or repeated form values
        raw_tags = request.data.get('tags') or request.data.getlist('tags') if hasattr(request.data, 'getlist') else None
        if not file:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        # create track with optional cover
        if cover:
            track = Track.objects.create(title=title, file=file, cover=cover)
        else:
            track = Track.objects.create(title=title, file=file)

        # parse tags
        tag_names = []
        if raw_tags:
            import json
            if isinstance(raw_tags, (list, tuple)):
                tag_names = [str(t).strip() for t in raw_tags if str(t).strip()]
            else:
                try:
                    parsed = json.loads(raw_tags)
                    if isinstance(parsed, (list, tuple)):
                        tag_names = [str(t).strip() for t in parsed if str(t).strip()]
                    else:
                        tag_names = [p.strip() for p in str(raw_tags).split(',') if p.strip()]
                except Exception:
                    tag_names = [p.strip() for p in str(raw_tags).split(',') if p.strip()]

        for name in tag_names:
            tag_obj, _ = Tag.objects.get_or_create(name=name.lower())
            track.tags.add(tag_obj)
        serializer = TrackSerializer(track, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class TrackListView(generics.ListAPIView):
    queryset = Track.objects.all().prefetch_related('tags').order_by('-uploaded_at')
    serializer_class = TrackSerializer


class GenerateMixView(APIView):
    def post(self, request):
        prompt = request.data.get('prompt')
        if not prompt:
            return Response({'error': 'prompt is required'}, status=400)
        # Attempt to extract tag tokens from the prompt to filter tracks
        import re
        tokens = re.findall(r"\w+", prompt.lower())
        tag_qs = Tag.objects.filter(name__in=tokens)
        if tag_qs.exists():
            tracks_qs = Track.objects.filter(tags__in=tag_qs).distinct()
        else:
            tracks_qs = Track.objects.all()

        tracks = list(tracks_qs)
        if not tracks:
            return Response({'error': 'no tracks uploaded'}, status=400)

        # Build simple context for LLM
        track_ctx = [{'id': t.id, 'title': t.title} for t in tracks]
        # If OpenAI key available, call API; otherwise fallback to heuristic
        playlist_items = []
        def _extract_json_from_text(text: str):
            # Try to extract a JSON array from the model output
            try:
                # direct parse first
                return json.loads(text)
            except Exception:
                # try to find a substring that is a JSON array
                import re

                m = re.search(r"(\[.*\])", text, re.S)
                if m:
                    try:
                        return json.loads(m.group(1))
                    except Exception:
                        return None
                return None

        if OPENAI_KEY:
            try:
                system = (
                    "You are a DJ assistant that selects 3-6 tracks from available tracks and returns a JSON list of objects"
                    " with fields {\"id\": <track id>, \"order\": <int>, \"weight\": <float>}."
                    " Only output valid JSON (an array)."
                )
                user_msg = f"Prompt: {prompt}\nAvailable tracks: {json.dumps(track_ctx)}"
                resp = openai.ChatCompletion.create(
                    model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
                    max_tokens=500,
                )
                text = resp.choices[0].message.content
                parsed = _extract_json_from_text(text)
                if isinstance(parsed, list):
                    playlist_items = parsed
            except Exception:
                playlist_items = []

        if not playlist_items:
            # Simple heuristic: pick up to 5 tracks randomly ordered
            import random

            chosen = random.sample(tracks, min(5, len(tracks)))
            playlist_items = []
            for i, t in enumerate(chosen):
                playlist_items.append({'id': t.id, 'order': i, 'weight': round(random.uniform(0.5, 1.0), 2)})

        # Create playlist
        playlist = Playlist.objects.create(name=f"Mix: {prompt}"[:255], prompt=prompt)
        selected_ids = []
        for item in playlist_items:
            try:
                track = Track.objects.get(id=item['id'])
            except Exception:
                continue
            PlaylistItem.objects.create(
                playlist=playlist,
                track=track,
                order=item.get('order', 0),
                weight=item.get('weight', 1.0),
            )
            selected_ids.append(track.id)

        # Bulk-increment selection counters to avoid race conditions
        if selected_ids:
            Track.objects.filter(id__in=selected_ids).update(times_selected=models.F('times_selected') + 1)

        serializer = PlaylistSerializer(playlist, context={'request': request})
        # Invalidate top tracks cache (ignore caching errors when Redis unavailable)
        try:
            cache.delete('top_tracks')
        except Exception:
            pass
        return Response(serializer.data)


class TrackDetailView(APIView):
    def delete(self, request, pk):
        try:
            track = Track.objects.get(pk=pk)
        except Track.DoesNotExist:
            return Response({'error': 'not found'}, status=404)
        # remove file from storage
        try:
            track.file.delete(save=False)
        except Exception:
            pass
        track.delete()
        # invalidate caches
        try:
            cache.delete('top_tracks')
        except Exception:
            pass
        return Response(status=204)


class TopTracksView(APIView):
    def get(self, request):
        try:
            cached = cache.get('top_tracks')
        except Exception:
            cached = None
        if cached:
            return Response(cached)
        # Aggregate by times_selected
        qs = Track.objects.order_by('-times_selected')[:10]
        serializer = TrackSerializer(qs, many=True, context={'request': request})
        data = serializer.data
        try:
            cache.set('top_tracks', data, timeout=60 * 5)
        except Exception:
            pass
        return Response(data)


class TagListView(generics.ListAPIView):
    from .models import Tag
    queryset = Tag.objects.all().order_by('name')
    def list(self, request, *args, **kwargs):
        q = request.GET.get('q')
        qs = self.queryset
        if q:
            qs = qs.filter(name__icontains=q)
        return Response([t.name for t in qs[:50]])


class TagSuggestView(APIView):
    def post(self, request):
        """Suggest tags given a free-form prompt. Returns JSON array of suggestions."""
        prompt = request.data.get('prompt') or request.data.get('q')
        if not prompt:
            return Response([], status=200)
        prompt = str(prompt).lower()
        # existing tags
        from .models import Tag
        tag_names = list(Tag.objects.values_list('name', flat=True))
        # candidate tokens
        import re
        tokens = re.findall(r"\w+", prompt)
        # fuzzy match using difflib
        import difflib
        suggestions = set()
        for t in tokens:
            matches = difflib.get_close_matches(t, tag_names, n=5, cutoff=0.6)
            for m in matches:
                suggestions.add(m)

        # also try to extract via OpenAI if available
        if OPENAI_KEY:
            try:
                system = "Extract a short list (3-6) of tag keywords from the user's prompt. Return only a JSON array of strings."
                resp = openai.ChatCompletion.create(
                    model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
                    messages=[{"role":"system","content":system},{"role":"user","content":prompt}],
                    max_tokens=120,
                )
                text = resp.choices[0].message.content
                # try to parse JSON
                import json
                parsed = None
                try:
                    parsed = json.loads(text)
                except Exception:
                    import re
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
