// Render text cards / captions to 1920x1080 PNGs (transparent unless a background is set), for ffmpeg to overlay.
// usage: bun tools/video/card.ts <cards.json> <outDir> [width=2560]   (designed at 1920x1080, rendered at width/1920 density)
//   cards.json: [{ "name": "title", "html": "<h1>…</h1>", "bg": "#000" }, …]  -> <outDir>/<name>.png
import { chromium } from "playwright";

const [spec, out, width = "2560"] = process.argv.slice(2);
const cards: { name: string; html: string; bg?: string }[] = await Bun.file(spec).json();
const css = `
  html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:-apple-system,"SF Pro Display",system-ui,sans-serif;color:#f5f5f7;-webkit-font-smoothing:antialiased}
  .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:28px}
  h1{font-size:112px;font-weight:700;letter-spacing:-0.035em;margin:0;line-height:1.02}
  h2{font-size:64px;font-weight:600;letter-spacing:-0.025em;margin:0;line-height:1.1}
  p{font-size:38px;font-weight:400;color:#a1a1a6;margin:0;letter-spacing:-0.01em}
  .grad{background:linear-gradient(90deg,#f5a97f,#d97757 45%,#c084fc);-webkit-background-clip:text;color:transparent}
  .prompt{font-size:46px;font-weight:500;letter-spacing:-0.015em;padding:34px 48px;border-radius:28px;background:#1c1c1e;box-shadow:0 0 0 1px #2c2c2e;max-width:1400px;text-align:left;line-height:1.35}
  .prompt b{color:#d97757;font-weight:600;margin-right:18px}
  .lower{position:absolute;left:228px;top:70px;display:flex;align-items:center;gap:20px;padding:20px 34px 20px 24px;border-radius:999px;background:rgba(18,18,20,.78);backdrop-filter:blur(20px);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 20px 60px rgba(0,0,0,.45)}
  .lower .n{white-space:nowrap;flex:none;font-size:24px;font-weight:600;color:#1c1c1e;background:#f5f5f7;border-radius:999px;padding:6px 14px;font-variant-numeric:tabular-nums}
  .lower .t{white-space:nowrap;font-size:40px;font-weight:600;letter-spacing:-0.02em}
  .lower .s{font-size:30px;color:#a1a1a6;margin-left:6px}
  .lower .x{font-size:26px;font-weight:600;color:#d97757;margin-left:10px;font-variant-numeric:tabular-nums}
  .speed{position:absolute;right:96px;top:72px;font-size:30px;font-weight:600;color:#f5f5f7;padding:10px 22px;border-radius:999px;background:rgba(18,18,20,.7);box-shadow:0 0 0 1px rgba(255,255,255,.1);font-variant-numeric:tabular-nums}
  .stats{display:flex;gap:120px;margin-top:24px}
  .stats div{display:flex;flex-direction:column;gap:8px}
  .stats b{font-size:96px;font-weight:700;letter-spacing:-0.035em}
  .stats span{font-size:30px;color:#a1a1a6}
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: Number(width) / 1920 });
for (const c of cards) {
  await page.setContent(`<html><head><style>${css}</style></head><body style="background:${c.bg ?? "transparent"}">${c.html}</body></html>`);
  await page.screenshot({ path: `${out}/${c.name}.png`, omitBackground: !c.bg });
}
await browser.close();
console.log(`${cards.length} cards -> ${out}`);
