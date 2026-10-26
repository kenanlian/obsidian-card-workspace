These small fixtures are generated locally with FFmpeg; they contain no external artwork.

```
ffmpeg -f lavfi -i color=c=red:s=16x8:d=0.1 -frames:v 1 -c:v libaom-av1 -still-picture 1 red.avif
ffmpeg -f lavfi -i testsrc=size=16x8:rate=2:duration=1 -frames:v 2 animated.gif
```

The Chromium image checks decode both through the production thumbnail generator.
