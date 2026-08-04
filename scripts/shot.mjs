// Visual QA: screenshots of the main states via headless chromium.
import { chromium } from "playwright";

const base = "http://127.0.0.1:1420";
const out = "/tmp/shots";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(base + "/");
await page.waitForTimeout(1400);
await page.screenshot({ path: `${out}/01-library.png` });

await page.getByText("袖口のキルト").dblclick();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/02-playing.png` });

await page.click('button[title="沉浸模式"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/03-immersive.png` });

await page.goto(base + "/#empty");
await page.reload();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${out}/04-empty.png` });

await page.goto(base + "/#error");
await page.reload();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${out}/05-error.png` });

await browser.close();
console.log("shots done");
