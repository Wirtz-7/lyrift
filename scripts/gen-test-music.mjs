// Generates synthetic test tracks (sine WAVs) + an original placeholder .lrc
// into ~/lyrift-test-music for manual smoke testing.
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const out = join(homedir(), "lyrift-test-music", "测试专辑");
mkdirSync(out, { recursive: true });

function wav(path, secs, freq) {
  const rate = 44100;
  const n = Math.floor(rate * secs);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    // gentle amplitude LFO so track changes are audible
    const amp = 0.25 * (0.7 + 0.3 * Math.sin((2 * Math.PI * i) / (rate * 2)));
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * amp * 32767);
    data.writeInt16LE(s, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

wav(join(out, "01 - 晨间频率.wav"), 24, 392);
wav(join(out, "02 - 午后频率.wav"), 20, 494);
wav(join(out, "03 - 夜间频率.wav"), 28, 330);

// original placeholder lyric, line-level timestamps
const lines = [
  [0, "测试歌词第一行"],
  [4, "测试歌词第二行"],
  [8, "波形在窗外流动"],
  [12, "频率替我问候你"],
  [16, "第三段副歌来临"],
  [20, "把音量调到刚好"],
  [24, "最后一行慢慢淡出"],
];
const lrc = lines.map(([t, s]) => `[00:${String(t).padStart(2, "0")}.00] ${s}`).join("\n") + "\n";
writeFileSync(join(out, "01 - 晨间频率.lrc"), lrc);
console.log("test music at", out);
