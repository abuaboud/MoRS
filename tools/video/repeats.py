# Flag moments in a cut that a viewer would read as a replay: the game picture comes back to something already shown
# (a retry from the same spot, the same NPC line, the same room) after the cut had moved on to something else.
# usage: python3 tools/video/repeats.py final.mp4 [edit.json]   -> "out A-B looks like out C (already shown)"; exit 1 if any
# Fix each one in the edit: speed it up and caption it as a retry/second visit, or move the beat boundary so the
# fast segment doesn't preview what the slow beat then shows again.
import numpy as np, subprocess, sys
FPS = 4
f = sys.argv[1]
# game view + dialogue box, below the caption pill (the game sits at 48,171, 1530x1006 in the 2560x1440 viewer)
v = np.frombuffer(subprocess.check_output(["ffmpeg", "-v", "error", "-i", f, "-vf",
    f"fps={FPS},crop=1530:560:48:620,scale=60:22,format=gray", "-f", "rawvideo", "-"]), np.uint8).reshape(-1, 60 * 22).astype(np.float32)
hits = []
for i in range(len(v)):
    if v[i].mean() < 25: continue                      # black or a card
    for j in range(0, i - 2 * FPS):                     # something shown >= 2 s earlier...
        if np.abs(v[j] - v[i]).mean() < 2.0 and np.abs(v[j:i] - v[i]).mean(1).max() > 9:   # ...and the cut moved away in between
            hits.append((i / FPS, j / FPS)); break
runs = []
for t, s in hits:
    if runs and t - runs[-1][1] <= 0.5: runs[-1][1] = t
    else: runs.append([t, t, s])
bad = [r for r in runs if r[1] - r[0] >= 0.5]
for a, b, s in bad: print(f"out {a:6.2f}-{b:6.2f}s looks like out {s:6.2f}s (already shown)")
sys.exit(1 if bad else 0)
