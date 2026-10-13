# Thumbnail strip of a cut for checking what YouTube actually plays (see tools/video/ytcheck.js and the produce-video skill).
# usage: python3 tools/video/mkref.py master.mp4 > ref.b64   -> base64 of 1 fps thumbnails of the game area (8x5 gray, 4-bit)
import sys, subprocess, base64, numpy as np
# the game sits at 48,171 (1530x1006) in the 2560x1440 viewer
a = np.frombuffer(subprocess.check_output(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-vf",
    "fps=1,scale=2560:1440,crop=1530:1006:48:171,scale=8:5:flags=area,format=gray", "-f", "rawvideo", "-"]), np.uint8)
b = (a // 16).reshape(-1, 20, 2)
print(base64.b64encode((b[:, :, 0] * 16 + b[:, :, 1]).astype(np.uint8).tobytes()).decode())
