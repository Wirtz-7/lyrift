import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:1420/");
await page.getByText("袖口のキルト").waitFor();
await page.getByText("袖口のキルト").dblclick();
await page.click('button[title="沉浸模式"]');

const immersive = page.locator(".fixed.inset-0.z-40");
const lyrics = page.locator(".lyrics-scroll");
await lyrics.waitFor();

for (const viewport of [
  { width: 960, height: 640 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
]) {
  await page.setViewportSize(viewport);
  const [rootBox, lyricBox, coverBox, repeatBox] = await Promise.all([
    immersive.boundingBox(),
    lyrics.boundingBox(),
    immersive.getByRole("img", { name: "袖口のキルト" }).boundingBox(),
    page.getByTitle("重复模式").boundingBox(),
  ]);
  assert.deepEqual(rootBox, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  assert(lyricBox && lyricBox.x > viewport.width * 0.42, `lyrics too far left at ${viewport.width}px`);
  assert(coverBox && coverBox.x + coverBox.width < lyricBox.x, `cover overlaps lyrics at ${viewport.width}px`);
  assert(repeatBox && repeatBox.y + repeatBox.height <= viewport.height, `controls overflow at ${viewport.width}px`);
}

const scrollbar = await lyrics.evaluate((el) => ({
  width: getComputedStyle(el).scrollbarWidth,
  webkitDisplay: getComputedStyle(el, "::-webkit-scrollbar").display,
}));
assert.equal(scrollbar.width, "none");
assert.equal(scrollbar.webkitDisplay, "none");

const blurred = page.locator(".lyric-line").nth(3);
const before = await lyrics.evaluate((el) => el.scrollTop);
await lyrics.hover();
await page.mouse.wheel(0, 360);
await page.waitForTimeout(30);
assert((await lyrics.evaluate((el) => el.scrollTop)) > before, "lyrics no longer scroll");
assert(await lyrics.evaluate((el) => el.classList.contains("lyrics-scrolling")));
assert.equal(await blurred.evaluate((el) => getComputedStyle(el).filter), "none");
await page.waitForTimeout(260);
assert(!(await lyrics.evaluate((el) => el.classList.contains("lyrics-scrolling"))));
const blur = Number((await blurred.evaluate((el) => getComputedStyle(el).filter)).match(/[\d.]+/)?.[0] ?? 0);
assert(blur <= 1.25, `inactive lyric blur is ${blur}px`);
await page.locator(".lyric-line").nth(6).click();
await page.waitForTimeout(500);
assert.deepEqual(errors, []);

await mkdir("/tmp/shots", { recursive: true });
await page.screenshot({ path: "/tmp/shots/03-immersive.png" });
await page.setViewportSize({ width: 1920, height: 1080 });
await page.screenshot({ path: "/tmp/shots/03-immersive-wide.png" });
await browser.close();
console.log("immersive QA ok");
