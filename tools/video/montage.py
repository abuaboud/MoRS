# Cut a recording (raw.mp4 + log.jsonl from tools/record.ts) into a video from an edit list. Stdlib + ffmpeg + bun.
# usage: python3 tools/video/montage.py edit.json out.mp4      (relative paths in edit.json are relative to its folder)
#
# edit.json: {"dir": "<recording dir>", "cards": "<card png dir>", "player": "islander2", "size": [2560, 1440], "segments": [
#   {"card": "title", "dur": 2.5},                          a full-screen card (png from card.ts)
#   {"studio": true, "from": 120, "to": 300, "speed": 8}    the real viewer with the game in it (tools/video/panel.ts),
#                                                           seconds into the recording, played `speed`x (or "dur" seconds)
# ]}
# Any segment: "overlay" = a transparent card on top (the same overlay on the next segment doesn't fade in again);
#   "fade": false = cut instead of fading, for seamless joins.
# "audio": [{"file", "at", "from"?, "dur"?, "gain"? (dB), "fadein"?, "fadeout"?, "bus": "music" | "vo" | "sfx"}]
#   lays a soundtrack, normalised to -16 LUFS. "duck": true dips the music under the voice (off by default: the dip is
#   audible as a swell around every line). "picture": "out.mp4" skips the segments and only re-mixes the sound.
# Output: size (default 2560x1440), 30 fps, H.264 crf 16 per segment, joined without re-encoding.
import json, os, subprocess, sys, tempfile

edit_path, out = sys.argv[1], sys.argv[2]
edit = json.load(open(edit_path))
base = os.path.dirname(os.path.abspath(edit_path))
path = lambda p: os.path.join(base, p)
rec, cards = path(edit["dir"]), path(edit.get("cards", "cards"))
W, H = edit.get("size", [2560, 1440])
FPS, FADE = 30, 0.25
tmp = tempfile.mkdtemp()
here = os.path.dirname(os.path.abspath(__file__))
enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]
probe = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))

def run(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)

def fades(d, s):
    return f",fade=t=in:d={FADE},fade=t=out:st={max(0, d - FADE)}:d={FADE}" if s.get("fade", True) else ""

parts, prev_overlay = [], None
if not edit.get("picture"):
    # raw.mp4 seconds per wall-clock second, from the log's start/stop: a recording that dropped frames runs short,
    # and this maps event time onto video time
    head = json.loads(open(f"{rec}/log.jsonl").readline())
    K = probe(f"{rec}/raw.mp4") / ((head["stop"] - head["start"]) / 1000)
for i, s in enumerate([] if edit.get("picture") else edit["segments"]):
    part = f"{tmp}/{i:03d}.mp4"
    if "card" in s:
        d = s["dur"]
        inputs, fc, nxt = ["-loop", "1", "-t", str(d), "-i", f"{cards}/{s['card']}.png"], [f"[0:v]scale={W}:{H}:flags=lanczos,format=yuv420p,setsar=1{fades(d, s)}[v]"], 1
    else:  # studio: the viewer rendered by panel.ts at 2560x1440, with the game at exactly 2x (nearest-neighbour) in its slot
        span = s["to"] - s["from"]
        speed = span / s["dur"] if "dur" in s else s.get("speed", 1)
        d = span / speed
        pd = f"{tmp}/panel{i}"
        subprocess.run(["bun", f"{here}/panel.ts", rec, str(s["from"]), str(s["to"]), f"{speed:g}", edit.get("player", ""), pd],
                       check=True, stdout=subprocess.DEVNULL)
        slot = {k: round(v) for k, v in json.load(open(f"{pd}/slot.json")).items()}
        inputs = ["-f", "concat", "-safe", "0", "-i", f"{pd}/panel.txt", "-ss", str(s["from"] * K), "-t", str(span * K), "-i", f"{rec}/raw.mp4"]
        fc = [f"[0:v]fps={FPS},format=yuv420p,setsar=1[bg]",
              f"[1:v]setpts=(PTS-STARTPTS)/{speed * K},fps={FPS},crop=765:503:0:0,scale={slot['w']}:{slot['h']}:flags=neighbor,setsar=1[g]",
              f"[bg][g]overlay={slot['x']}:{slot['y']}:shortest=1,scale={W}:{H}:flags=lanczos{fades(d, s)}[v]"]
        nxt = 2
    last = "v"
    if s.get("overlay"):
        inputs += ["-loop", "1", "-i", f"{cards}/{s['overlay']}.png"]
        appear = "" if s["overlay"] == prev_overlay else ",fade=t=in:d=0.2:alpha=1"
        fc += [f"[{nxt}:v]scale={W}:{H}:flags=lanczos,format=rgba{appear},setsar=1[o]", "[v][o]overlay=shortest=1[vo]"]
        last = "vo"
    run([*inputs, "-filter_complex", ";".join(fc), "-map", f"[{last}]", "-t", str(d), *enc, part])
    prev_overlay = s.get("overlay")
    parts.append(part)
    print(f"segment {i + 1}/{len(edit['segments'])}", flush=True)

picture = f"{tmp}/picture.mp4"
if edit.get("picture"):
    run(["-i", path(edit["picture"]), "-map", "0:v", "-c", "copy", picture])
else:
    with open(f"{tmp}/list.txt", "w") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    run(["-f", "concat", "-safe", "0", "-i", f"{tmp}/list.txt", "-c", "copy", picture])

if not edit.get("audio"):
    os.replace(picture, out)
else:
    vd = probe(picture)
    ins, fc, buses = ["-i", picture], [], {"music": [], "vo": [], "sfx": []}
    for n, a in enumerate(edit["audio"], 1):
        ins += ["-i", path(a["file"])]
        length = a.get("dur") or probe(path(a["file"])) - a.get("from", 0)
        chain = [f"atrim=start={a.get('from', 0)}:duration={length}", "asetpts=PTS-STARTPTS", "aresample=48000",
                 "aformat=channel_layouts=stereo", f"volume={a.get('gain', 0)}dB"]
        if a.get("fadein"): chain.append(f"afade=t=in:d={a['fadein']}")
        if a.get("fadeout"): chain.append(f"afade=t=out:st={max(0, length - a['fadeout'])}:d={a['fadeout']}")
        ms = int(a.get("at", 0) * 1000)
        chain.append(f"adelay={ms}|{ms}")
        fc.append(f"[{n}:a]{','.join(chain)}[a{n}]")
        buses[a.get("bus", "sfx")].append(f"[a{n}]")
    for bus, labels in buses.items():
        if labels:
            fc.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest[{bus}]")
    if buses["music"] and buses["vo"]:
        # make room for the voice: no rumble under it, and a dip where a deep voice and a bassline collide
        fc += ["[vo]highpass=f=90[vo]", "[music]equalizer=f=300:t=q:w=1:g=-3[music]"]
        if edit.get("duck"):  # the key is padded: sidechaincompress stops at its shorter input
            fc += ["[vo]asplit=2[vo][vokey]", "[vokey]apad[vokey]", "[music][vokey]sidechaincompress=threshold=0.03:ratio=4:attack=120:release=900[music]"]
    mixed = [f"[{b}]" for b in buses if buses[b]]
    fc.append(f"{''.join(mixed)}amix=inputs={len(mixed)}:normalize=0:duration=longest,apad,atrim=0:{vd},loudnorm=I=-16:TP=-1.5:LRA=11[a]")
    run([*ins, "-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out])
print(f"wrote {out}")
