# Put the series intro in front of a cut: the Tutorial Island video's opening (title, "It sees what's around it", "It knows
# the wiki", "It has two actions", "It writes code, runs it, and tries again", with its voice-over) and then its
# "Let's watch it play." card with this video's own subtitle, under the original "Let's watch it play." line.
# usage: python3 tools/video/intro.py "<subtitle>" master.mp4 out.mp4     (run from the repo root)
import json, subprocess, sys, tempfile
sub, master, out = sys.argv[1:4]
SRC, CUT, END = "proof/tutorial-island/final.mp4", 14.8, 16.6   # the intro hard-cuts to the card at 14.8 s; the card ends at 16.6 s
tmp = tempfile.mkdtemp()
run = lambda *a: subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", *a], check=True)
enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
json.dump([{"name": "watch", "bg": "#000", "html": f"<div class='center'><h1>Let's watch it play.</h1><p>{sub}</p></div>"}], open(f"{tmp}/cards.json", "w"))
subprocess.run(["bun", "tools/video/card.ts", f"{tmp}/cards.json", tmp], check=True, stdout=subprocess.DEVNULL)
v = "fps=30,scale=2560:1440,format=yuv420p,setsar=1"
# 1) the intro on its own: the source's picture up to the cut, then our card; the source's sound for the whole 16.6 s
run("-t", str(END), "-i", SRC, "-loop", "1", "-t", str(END - CUT), "-i", f"{tmp}/watch.png", "-filter_complex",
    f"[0:v]trim=0:{CUT},setpts=PTS-STARTPTS,{v}[a];[1:v]{v}[b];[a][b]concat=n=2:v=1:a=0[v];"
    f"[0:a]atrim=0:{END},asetpts=PTS-STARTPTS,afade=t=out:st={END - 0.3}:d=0.3[au]", "-map", "[v]", "-map", "[au]", *enc, f"{tmp}/intro.mp4")
# 2) intro + cut, joined like montage.py joins its parts (same codec settings, no re-encode)
open(f"{tmp}/list.txt", "w").write(f"file '{tmp}/intro.mp4'\nfile '{tmp}/master.mp4'\n")
run("-i", master, "-c", "copy", "-map", "0", f"{tmp}/master.mp4")
run("-f", "concat", "-safe", "0", "-i", f"{tmp}/list.txt", "-c", "copy", "-movflags", "+faststart", out)
print(f"wrote {out}")
