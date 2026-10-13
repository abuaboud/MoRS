// Render the real MoRS viewer (its ?video layout) for a span of a recording, as 2560x1440 stills: one per
// state change plus one per second for the clock. Recorded gateway events are replayed into the page under a fake clock.
// usage: bun tools/video/panel.ts <recDir> <fromSec> <toSec> <speed> <player> <outDir>
//   reads <recDir>/log.jsonl (from tools/record.ts); writes <outDir>/*.jpg, <outDir>/panel.txt (ffmpeg concat list), <outDir>/slot.json
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [rec, fromS, toS, speedS, player, out] = process.argv.slice(2);
const speed = Number(speedS);
mkdirSync(out, { recursive: true });
const [head, ...lines] = readFileSync(`${rec}/log.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const t0 = head.start;
const from = t0 + Number(fromS) * 1000, to = t0 + Number(toS) * 1000;
let events = lines.filter((e) => e.type !== "progress");
// only the run being filmed: everything from its last "run" boundary (the gateway also replays older transcripts)
const runAt = events.map((e, i) => (e.type === "run" && e.t <= to ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
events = events.slice(runAt).sort((a, b) => a.t - b.t);

const times = new Set<number>([from]);
for (let t = Math.ceil(from / 1000) * 1000; t < to; t += 1000) times.add(t);
for (const e of events) if (e.t > from && e.t < to) times.add(e.t);
const ts = [...times].sort((a, b) => a - b);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
await page.clock.setFixedTime(from);
await page.goto(`http://${process.env.MORS_GATEWAY ?? "localhost:8888"}/?video&player=${player}&speed=${speed}`);
await page.waitForFunction(() => (window as any).mors);
const slot = await page.locator("#game-slot").boundingBox();
writeFileSync(`${out}/slot.json`, JSON.stringify({ x: slot!.x * 2, y: slot!.y * 2, w: slot!.width * 2, h: slot!.height * 2 }));

let fed = 0, list = "";
for (let i = 0; i < ts.length; i++) {
  const T = ts[i];
  const batch: any[] = [];
  while (fed < events.length && events[fed].t <= T) batch.push(events[fed++]);
  await page.clock.setFixedTime(T);
  await page.evaluate((b) => { for (const m of b) (window as any).mors.timeline.handle(m, false); }, batch);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = `${String(i).padStart(5, "0")}.jpg`;
  await page.screenshot({ path: `${out}/${file}`, type: "jpeg", quality: 92 });
  list += `file '${file}'\nduration ${(((ts[i + 1] ?? to) - T) / 1000 / speed).toFixed(4)}\n`;
  if (i % 100 === 0) console.log(`${i}/${ts.length}`);
}
writeFileSync(`${out}/panel.txt`, list + `file '${String(ts.length - 1).padStart(5, "0")}.jpg'\n`);
await browser.close();
console.log(`${ts.length} stills -> ${out}`);
