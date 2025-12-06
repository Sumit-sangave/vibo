from django.urls import path
from .views import UploadTrackView, TrackListView, GenerateMixView, TopTracksView, TrackDetailView
from .views import TagListView, TagSuggestView

urlpatterns = [
    path('tracks/upload/', UploadTrackView.as_view(), name='upload-track'),
    path('tracks/', TrackListView.as_view(), name='list-tracks'),
    path('tracks/<int:pk>/', TrackDetailView.as_view(), name='track-detail'),
    path('tags/', TagListView.as_view(), name='tags-list'),
    path('tags/suggest/', TagSuggestView.as_view(), name='tags-suggest'),
    path('generate-mix/', GenerateMixView.as_view(), name='generate-mix'),
    path('stats/top-tracks/', TopTracksView.as_view(), name='top-tracks'),
]
