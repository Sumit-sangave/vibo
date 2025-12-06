from django.contrib import admin
from .models import Track, Playlist, PlaylistItem

admin.site.register(Track)
admin.site.register(Playlist)
admin.site.register(PlaylistItem)
