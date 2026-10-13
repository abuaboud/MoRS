// Paste into the YouTube watch page (claude-in-chrome javascript_tool) to check what YouTube actually plays.
// 1) ytSample(): plays the video at 2x and keeps [currentTime, 8x5 gray of the game area] every 0.25 s in window._samples.
//    It returns at once; wait about duration/2 s, then
// 2) ytCompare(ref) with ref = `python3 tools/video/mkref.py master.mp4` (1 fps): lists samples showing the wrong moment.
window.ytSample = async function () {
  window._samples = []; const v = document.querySelector("video"); v.muted = true; v.pause(); v.currentTime = 0;
  await new Promise((r) => setTimeout(r, 1500)); v.playbackRate = 2; await v.play();
  const c = document.createElement("canvas"); c.width = 8; c.height = 5; const x = c.getContext("2d", { willReadFrequently: true });
  clearInterval(window._sampler);
  window._sampler = setInterval(() => {
    if (v.ended) return clearInterval(window._sampler);
    const k = v.videoWidth / 1280;   // the game sits at 24,85.5 (765x503) in the 1280x720 frame
    x.drawImage(v, 24 * k, 85.5 * k, 765 * k, 503 * k, 0, 0, 8, 5);
    const d = x.getImageData(0, 0, 8, 5).data, g = [];
    for (let i = 0; i < 40; i++) g.push((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3);
    window._samples.push([v.currentTime, g]);
  }, 250);
  return "sampling " + v.duration.toFixed(1) + " s at 2x";
};
window.ytCompare = function (ref) {
  const raw = atob(ref), nf = raw.length / 20, R = [];
  for (let f = 0; f < nf; f++) { const a = []; for (let i = 0; i < 20; i++) { const b = raw.charCodeAt(f * 20 + i); a.push((b >> 4) * 16 + 8, (b & 15) * 16 + 8); } R.push(a); }
  const bad = []; let n = 0;
  for (const [t, g] of window._samples) {
    if (g.reduce((a, b) => a + b) / 40 < 12) continue; n++;
    const ds = R.map((r) => r.reduce((s, v, i) => s + Math.abs(v - g[i]), 0) / 40);
    const lo = Math.max(0, Math.floor(t) - 1), hi = Math.min(nf - 1, Math.ceil(t) + 1);
    const near = Math.min(...ds.slice(lo, hi + 1)), best = ds.indexOf(Math.min(...ds));
    if (near - ds[best] > 6) bad.push(`${t.toFixed(1)}s looks like ${best}s (${ds[best].toFixed(0)} vs ${near.toFixed(0)} near its own time)`);
  }
  return `${n} samples of ${window._samples.length}, ${bad.length} out of place${bad.length ? ": " + bad.slice(0, 12).join(" | ") : ""}`;
};
