---
name: produce-video
description: Record a MoRS run (Claude playing OSRS) and turn it into a proof video, the whole run uncut, sped up and slowed down, inside the real viewer UI. Use when asked to record, film, or make a demo / montage / highlight / trailer of a run like Tutorial Island or a quest.
---

# Produce a run video

The video is **proof**. People will assume the bad parts were cut, so don't cut. Every second of the run stays in, and only the speed changes:
- **Fast (16×)** through routine play.
- **Slow (2×)** when Claude is stuck and recovering, or uses its memory.
- **Real time** for the finish line.

Every frame is the real MoRS viewer (header stats, the game, Claude's words, the steps with their code, the action log), so it looks like the software and nothing is invented. Aim for 2–2½ minutes.

## 1. Set up a clean take

- Server, gateway and client must be up (see the repo `CLAUDE.md`). `curl -s localhost:8888/state` must return a `gameState`.
- Fresh login screen: `docker restart <client container>` (`docker ps` shows its name).
- Restart the gateway (`pkill -f "bun gateway/server.ts"; bun gateway/server.ts &`). On start it replays the newest old transcript first. That's fine: the viewer resets on each `run` event, and `panel.ts` only uses the last run.
- Use a new account name. Lead the prompt with the goal in one plain sentence (`runs/prompts/tutorial-demo.md`). The Goal card shows its first lines.
- If a take goes wrong (a shortcut, a broken rule, a dead end), keep it and re-shoot. Claude writes the lesson into `playing/CLAUDE.md`, and the next take's "memory" moments come from exactly that.

## 2. Record

```sh
bun tools/record.ts <dir> &   # raw.mp4 (the game, 30 fps) + log.jsonl (header with start/stop, viewer events, tutorialProgress at 1 Hz)
python3 -c "import json;print(json.dumps({'type':'user','message':{'role':'user','content':open('runs/prompts/<prompt>.md').read()}}))" > in.jsonl
claude -p --input-format stream-json --replay-user-messages --output-format stream-json --verbose \
  --mcp-config .mcp.json --strict-mcp-config --permission-mode bypassPermissions --no-session-persistence \
  < in.jsonl > runs/<name>.jsonl 2> runs/<name>.err
```

- `--replay-user-messages` puts the prompt in the transcript, which is where the viewer's Goal card comes from. `--no-session-persistence` stops a second session log appearing, which the gateway would also tail.
- When the transcript has its `"type":"result"` line, wait a few seconds, then `kill -INT` the recorder (never `-9`, or raw.mp4 isn't finalized and log.jsonl never gets its header).

## 3. Find the beats

Times are seconds into the recording: `(t - start) / 1000`, with `start` from the first line of `log.jsonl`.
- `say` events: Claude's own words with timestamps. Lines that mention "stuck", "fails", "memory" or "notes" are the slow beats.
- `act` events with `"ok":false`: where it's failing. A run of red followed by a `say` explaining the fix is a STUCK beat.
- `progress` events: when each `tutorialProgress` step starts. Use them for the fast-section captions.
- **Check the footage for every beat** (`ffmpeg -ss <s> -i raw.mp4 -frames:v 1 x.jpg`; scale `s` by raw.mp4's length over `stop - start` if the recording dropped frames). Start a slow beat when the problem appears on screen (the popup, the open bank window), not when Claude starts talking about it, and keep it running until the fix lands.

- **Anchor every slow beat on the action, not on Claude's words.** A `say` comes seconds before or after what it describes. Take the beat's window from the `act` that does it (the click) and the chat line that confirms it ("You milk the cow."): start at most 2 s before the click, end at most 2 s after the confirmation. A slow beat that opens on the walk up to the event, under a caption that already names the event, reads as "it said it, then went back and showed it again".
- **Never let a fast segment preview a slow beat.** End the fast segment where the problem starts. If it runs into the stuck stretch, the slow beat after it shows the same spot again and looks like a replay.
- **Name retries and second visits.** The same NPC line, the same fence or the same room coming back is real but reads as a repeat. Run it fast and say so in the pill ("Second try", "Back to the professor with all three parts").

## 4. Cut

Write an edit list of **contiguous** `studio` segments from 0 to the end of `raw.mp4` (assert `seg[k].to == seg[k+1].from`). Each segment gets a caption pill. Then render the cards and the montage:

```sh
bun tools/video/card.ts cards.json <work>/cards      # HTML -> 2560x1440 PNGs (classes in card.ts: .center h1/h2/p, .prompt, .lower .n/.t/.s, .stats)
python3 tools/video/montage.py edit.json master.mp4   # segment format in its header
```

- `studio` segments run `tools/video/panel.ts`. It loads the viewer's `?video&player=<name>&speed=<n>` layout (1280×720 CSS at 2× = 2560×1440), replays `log.jsonl` into it under Playwright's fake clock, and screenshots each state change plus each second. `montage.py` then drops the game into `#game-slot` at exactly 2×, with nearest-neighbour scaling. The header chip shows "16× speed" / "Real time".
- Pill copy: `.n` = kind + speed (`16×`, `STUCK · 2×`, `MEMORY · 2×`, `DONE · real time`); `.t` = what's happening, in six to ten words, that the footage actually shows. Place them about 57px (1920 basis) below the top of `#game-slot` (it's centred, so read its position from `slot.json`; `top:313px` for the current layout), below the game's hover text, with `max-width:1060px` so they stay inside the game slot.
- Open with the prompt over the first fast segment (an overlay card with a dark scrim). Don't start on a black card.
- End with a stats card made of real numbers: runtime from the transcript's `result` (`duration_ms`), actions, the Problems count ("N problems, all recovered on its own"), and cost. Add "Nothing was cut". Then an end card with the name and the repo URL.
- Copy must be literally true. Say "One prompt", not "one sentence", if the prompt has more in it. "Writes the code", not "no scripts". Use the same words as the UI.

## Voice and music

- **Voiceover:** a few short lines, only on the slow beats, the arrival and the end, saying what the caption pill says. `GEMINI_API_KEY=... node tools/video/tts.mjs lines.json <dir>` makes one trimmed wav per line (voice `Charon`). Gemini TTS reads any style direction aloud, so pass only the words. Each line must fit inside its segment.
- **Music:** an original bed with a steady beat, from Google Lyria: `GEMINI_API_KEY=... node tools/video/music.mjs beat.mp3 ["prompt"]` (default `lyria-3.5`). Ask for an original piece with no drop and space for a narrator, never a known theme. Stretch it to the video's length first (`atempo`, pitch kept; more than ±15% means regenerate). A bed's own ending comes before its file ends (`beat-a.mp3` is 131 s but goes quiet at 118 s), so a cut that outlasts it goes silent over DONE and the cards. To lengthen one, jump back a whole number of bars (find the jump whose loudness envelope correlates best, then `acrossfade=d=1`), and check every master with `silencedetect=n=-45dB:d=2`: nothing may come back before the last frame.
- **Mix:** add an `"audio"` list to the edit (music on bus `music`, lines on bus `vo`, with a 30 ms fade in and 80 ms fade out on each line) and `"picture": "<rendered.mp4>"` to re-mix without re-rendering. Leave `"duck"` off: dipping the music under the voice is audible as a swell around every line. Keep the bed steady about 11 dB down instead.
- You can't listen, so measure: `ebur128` loudness (aim for -16 LUFS), and ask Gemini to listen for clicks, buzz or swells around each line. Newer TTS models send a whole WAV with a C2PA tag at the end; decoded as raw PCM, that makes a click and an electric burst at every line (tts.mjs handles it).

## Picture quality

- Masters are 2560×1440, 30 fps, H.264 CRF 16. The game is 765×503: only ever scale it by an integer factor with `flags=neighbor`.
- Overlaying scaled inputs needs `setsar=1` on each, or ffmpeg fails with "Invalid argument".
- This ffmpeg has no `drawtext`. All text comes from HTML cards (card.ts) or the viewer itself.

## Compress for sharing (like a YouTube upload)

**YouTube copies must use closed GOPs.** x265 defaults to open GOP: the frames after each keyframe may reference the GOP before it. YouTube splits an upload into chunks and transcodes them in parallel, and at open-GOP chunk joins it shows footage from the wrong chunk. Whole segments then play twice or out of order ("quest started, walk to the cows, stuck at the fence, quest started again"), while the local file plays fine. Encode the YouTube copy like this, and never upload an open-GOP HEVC:

```sh
ffmpeg -i master.mp4 -vf scale=1280:720:flags=lanczos -c:v libx265 -b:v 450k \
  -x265-params "open-gop=0:keyint=60:min-keyint=60:scenecut=0" -tag:v hvc1 -c:a aac -b:a 96k -movflags +faststart youtube.mp4
```

**Check the video on YouTube, not the local file.** After processing, play it in the browser (claude-in-chrome) at 2x and, every 0.4 s, draw the `<video>` to a 64x36 canvas and keep `[currentTime, gray pixels]`. Compare each sample with a 1 fps 16x9 thumbnail strip of the master (`python3 tools/video/mkref.py master.mp4`, passed into the page; `tools/video/ytcheck.js` has both steps). Every sample must match the master within 1.5 s of its own time. Also look at a tile of frames over the first 30 s, where the old bug showed. Only then link it.

Two-pass H.264 sized to the limit (30 MB to send a file, ~25 MB for the repo): `kbps = MB × 8000 / seconds × 0.95`.

```sh
for p in 1 2; do ffmpeg -y -i master.mp4 -c:v libx264 -preset slower -tune animation -b:v <kbps>k -maxrate <2×>k -bufsize <4×>k \
  -pix_fmt yuv420p -pass $p -passlogfile x264 $([ $p = 1 ] && echo "-f mp4 /dev/null" || echo "-movflags +faststart web.mp4"); done
```

## 5. Review, then ship

- Run `python3 tools/video/repeats.py final.mp4`. It lists every moment whose picture comes back to something already shown after the cut moved on. Each one is a re-edit (speed it up and name it, or move the boundary) unless it is a retry the pill already names.

- Pull a frame every 3 s (`ffmpeg -i out.mp4 -vf fps=1/3 f%02d.jpg`) and look at all of them. Look for captions that don't match the frame, pills over other text, slow beats that start late, and anything at 2× without a pill saying why.
- Have a subagent play Steve Jobs on those frames (verdict, then concrete edit-level fixes). Fix everything and re-review until it's approved.
- Ship it as `proof/<name>/`, with exactly three files: `log.jsonl` (the recording's log), `raw.mp4` (re-encode with `-preset veryslow -crf 26 -tune animation`; it stays visually identical) and `final.mp4` (the compressed cut). That folder is itself a recording: `montage.py` and `panel.ts` read it directly, so a re-cut needs nothing else. For the README, upload the video to YouTube (Unlisted is fine; a copy under 10 MB, 720p HEVC, if it goes through the browser upload tool) and link it from a poster frame with a play button drawn on it (`card.ts`), saved in `docs/screenshots/`. That works on GitHub web and in the mobile app. A `user-attachments` video plays inline on desktop only, and repo files only show as links. Link `raw.mp4`, `log.jsonl` and `final.mp4` under it. Edit lists, cards, voice clips, masters and samples are working files: delete them.
