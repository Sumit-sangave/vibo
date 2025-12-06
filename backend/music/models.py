from django.db import models


class Track(models.Model):
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to='tracks/')
    cover = models.FileField(upload_to='covers/', null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    times_selected = models.IntegerField(default=0)
    tags = models.ManyToManyField('Tag', blank=True)

    def __str__(self):
        return self.title


class Tag(models.Model):
    name = models.CharField(max_length=64, unique=True)

    def __str__(self):
        return self.name


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
