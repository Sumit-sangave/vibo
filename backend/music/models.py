from django.db import models
from cloudinary_storage.storage import MediaCloudinaryStorage


class Tag(models.Model):
    name = models.CharField(max_length=64, unique=True)

    def __str__(self):
        return self.name


class Track(models.Model):
    title = models.CharField(max_length=255)

    # Store audio file on Cloudinary
    file = models.FileField(
        upload_to='tracks/',
        storage=MediaCloudinaryStorage(),
    )

    # Store cover image on Cloudinary
    cover = models.FileField(
        upload_to='covers/',
        storage=MediaCloudinaryStorage(),
        null=True,
        blank=True,
    )

    duration = models.FloatField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    times_selected = models.IntegerField(default=0)

    # Many-to-many with Tag
    tags = models.ManyToManyField(Tag, blank=True)

    def __str__(self):
        return self.title


class Playlist(models.Model):
    name = models.CharField(max_length=255, blank=True)
    prompt = models.CharField(max_length=512)
    created_at = models.DateTimeField(auto_now_add=True)
    tracks = models.ManyToManyField(Track, through='PlaylistItem')

    def __str__(self):
        return f"Playlist {self.id} - {self.prompt}"


class PlaylistItem(models.Model):
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE)
    track = models.ForeignKey(Track, on_delete=models.CASCADE)
    order = models.IntegerField()
    weight = models.FloatField(default=1.0)

    class Meta:
        ordering = ['order']
