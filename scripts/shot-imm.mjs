import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
await page.addInitScript(() => {
  Element.prototype.scrollIntoView = () => {
    throw new Error("lyrics must not call scrollIntoView");
  };
});
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

const immersiveProgress = immersive.getByLabel("播放进度");
const activeLyric = () =>
  page.locator(".lyric-line").evaluateAll((lines) => lines.findIndex((line) => line.style.opacity === "1"));
const activeBeforeDrag = await activeLyric();
const progressBox = await immersiveProgress.boundingBox();
assert(progressBox);
await page.mouse.move(progressBox.x + 2, progressBox.y + progressBox.height / 2);
await page.mouse.down();
await page.mouse.move(progressBox.x + progressBox.width * 0.75, progressBox.y + progressBox.height / 2, { steps: 8 });
const previewPosition = Number(await immersiveProgress.inputValue());
assert(previewPosition > 30, "progress thumb did not preview the drag");
assert.equal(await activeLyric(), activeBeforeDrag, "dragging already seeked playback");
await page.mouse.up();
await page.waitForTimeout(30);
assert.notEqual(await activeLyric(), activeBeforeDrag, "seek was not committed on release");

const blurred = page.locator(".lyric-line").nth(3);
const before = await lyrics.evaluate((el) => el.scrollTop);
await lyrics.hover();
await page.mouse.wheel(0, 360);
await page.waitForTimeout(30);
assert((await lyrics.evaluate((el) => el.scrollTop)) > before, "lyrics no longer scroll");
assert(await lyrics.evaluate((el) => el.classList.contains("lyrics-scrolling")));
assert.equal(await blurred.evaluate((el) => getComputedStyle(el).filter), "none");
await page.waitForTimeout(1500);
assert(await lyrics.evaluate((el) => el.classList.contains("lyrics-scrolling")));
await page.waitForTimeout(550);
assert(!(await lyrics.evaluate((el) => el.classList.contains("lyrics-scrolling"))));
const blur = Number((await blurred.evaluate((el) => getComputedStyle(el).filter)).match(/[\d.]+/)?.[0] ?? 0);
assert(blur <= 1.25, `inactive lyric blur is ${blur}px`);
const autoScrollBefore = await lyrics.evaluate((el) => el.scrollTop);
await page.locator(".lyric-line").nth(6).click();
await page.waitForTimeout(500);
assert((await lyrics.evaluate((el) => el.scrollTop)) > autoScrollBefore, "active lyric did not scroll");
assert.deepEqual(
  await page.evaluate(() => ({
    window: window.scrollY,
    document: document.documentElement.scrollTop,
    body: document.body.scrollTop,
  })),
  { window: 0, document: 0, body: 0 },
  "active lyric scrolled the outer viewport",
);
assert.deepEqual(await immersive.boundingBox(), { x: 0, y: 0, width: 1280, height: 800 });
assert.deepEqual(errors, []);

await mkdir("/tmp/shots", { recursive: true });
await page.screenshot({ path: "/tmp/shots/03-immersive.png" });
await page.setViewportSize({ width: 1920, height: 1080 });
await page.screenshot({ path: "/tmp/shots/03-immersive-wide.png" });
await browser.close();
console.log("immersive QA ok");
