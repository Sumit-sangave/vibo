from rest_framework import serializers
from .models import Track, Playlist, PlaylistItem, Tag


class TrackSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()
    tags = serializers.SlugRelatedField(many=True, slug_field='name', queryset=Tag.objects.all(), required=False)

    class Meta:
        model = Track
        fields = ['id', 'title', 'file', 'url', 'cover_url', 'duration', 'uploaded_at', 'times_selected', 'tags']
        read_only_fields = ['id', 'uploaded_at', 'times_selected']

    def get_url(self, obj):
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url

    def get_cover_url(self, obj):
        if not obj.cover:
            return None
        request = self.context.get('request')
        try:
            if request:
                return request.build_absolute_uri(obj.cover.url)
            return obj.cover.url
        except Exception:
            return None


class PlaylistItemSerializer(serializers.ModelSerializer):
    track = TrackSerializer()

    class Meta:
        model = PlaylistItem
        fields = ['order', 'weight', 'track']


class PlaylistSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()

    class Meta:
        model = Playlist
        fields = ['id', 'name', 'prompt', 'created_at', 'items']

    def get_items(self, obj):
        items = obj.playlistitem_set.all()
        return PlaylistItemSerializer(items, many=True, context=self.context).data
