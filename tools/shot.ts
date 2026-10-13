// Screenshot the viewer page headlessly: bun tools/shot.ts out.png [waitSeconds]
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1120, height: 580 } });
await page.goto(process.env.URL ?? "http://localhost:8888/");
await page.waitForTimeout(Number(process.argv[3] ?? 4) * 1000);
await page.screenshot({ path: process.argv[2] ?? "/tmp/mors.png" });
await browser.close();
