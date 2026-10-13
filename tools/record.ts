// Record a run as two files, the same shape as proof/<name>/:
//   raw.mp4    the game stream at 30 fps, paced by the wall clock
//   log.jsonl  line 1 = {type:"recording", start, stop} (wall-clock ms); then every viewer event (Claude's words, steps
//              with their code, actions and results) and the game's tutorialProgress once a second, in time order
// usage: bun tools/record.ts <outDir>   (stop with Ctrl-C / SIGTERM)
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "recording";
const GW = process.env.MORS_GATEWAY ?? "localhost:8888";
mkdirSync(out, { recursive: true });
const start = Date.now();
const events = `${out}/.events.jsonl`; // the header goes on top when we stop
writeFileSync(events, "");
const log = (o: object) => appendFileSync(events, JSON.stringify(o) + "\n");

const game = Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "30", "-i", "-",
  "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", `${out}/raw.mp4`], { stdin: "pipe" });
let frame: Uint8Array | null = null;
const ws = new WebSocket(`ws://${GW}/view`);
ws.binaryType = "arraybuffer";
ws.onmessage = (m) => { if (typeof m.data === "string") appendFileSync(events, m.data + "\n"); else frame = new Uint8Array(m.data); };

// setInterval fires a little under 30 Hz, so write as many frames as the wall clock says are due (repeating the latest)
let written = 0;
const tick = setInterval(() => {
  if (!frame) return;
  for (const due = Math.floor(((Date.now() - start) * 30) / 1000); written < due; written++) game.stdin.write(frame);
}, 1000 / 30);
const poll = setInterval(async () => {
  try {
    const s = await (await fetch(`http://${GW}/state`)).json();
    log({ type: "progress", t: Date.now(), tutorialProgress: s.tutorialProgress, x: s.player?.pos?.x, y: s.player?.pos?.y });
  } catch {}
}, 1000);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const head = { type: "recording", start, stop: Date.now() };
  clearInterval(tick);
  clearInterval(poll);
  ws.close();
  game.stdin.end();
  await game.exited;
  const lines = readFileSync(events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  writeFileSync(`${out}/log.jsonl`, [head, ...lines].map((o) => JSON.stringify(o)).join("\n") + "\n");
  rmSync(events);
  console.log(`saved ${out}/raw.mp4 and ${out}/log.jsonl`);
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
