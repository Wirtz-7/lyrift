import type { LyricState, Track } from "./types";

// ponytail: mock covers are inline SVG gradients; real covers come from the
// Rust backend (step 5+) and replace these data-URIs.
const svgCover = (from: string, to: string, label: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs><rect width='600' height='600' fill='url(#g)'/><circle cx='452' cy='148' r='96' fill='rgba(255,255,255,0.14)'/><circle cx='150' cy='470' r='60' fill='rgba(0,0,0,0.18)'/><text x='48' y='548' font-family='sans-serif' font-size='42' fill='rgba(255,255,255,0.82)'>${label}</text></svg>`,
  );

const coverA = svgCover("#0e7490", "#9a3412", "真夜中の縫い目");
const coverB = svgCover("#312e81", "#475569", "阿司匹林之梦");
const coverC = svgCover("#9f1239", "#6d28d9", "折れ曲がった漫画");

export const MOCK_TRACKS: Track[] = [
  { id: "a1", title: "袖口のキルト", artist: "ミシンと夜", album: "真夜中の縫い目", duration: 222, cover: coverA, trackNumber: 1, year: 2023 },
  { id: "a2", title: "予測癖", artist: "ミシンと夜", album: "真夜中の縫い目", duration: 245, cover: coverA, trackNumber: 2, year: 2023 },
  { id: "a3", title: "石碑のように", artist: "ミシンと夜", album: "真夜中の縫い目", duration: 238, cover: coverA, trackNumber: 3, year: 2023 },
  { id: "b1", title: "凌晨回家", artist: "白昼夢遊", album: "阿司匹林之梦", duration: 202, cover: coverB, trackNumber: 1, year: 2024 },
  { id: "b2", title: "失灵的指南针", artist: "白昼夢遊", album: "阿司匹林之梦", duration: 231, cover: coverB, trackNumber: 2, year: 2024 },
  { id: "b3", title: "窗外的景色", artist: "白昼夢遊", album: "阿司匹林之梦", duration: 252, cover: coverB, trackNumber: 3, year: 2024 },
  { id: "c1", title: "手提げ袋の遺伝子", artist: "隠れ敬語", album: "折れ曲がった漫画", duration: 213, cover: coverC, trackNumber: 1, year: 2022 },
  { id: "c2", title: "折れ曲がった漫画", artist: "隠れ敬語", album: "折れ曲がった漫画", duration: 260, cover: coverC, trackNumber: 2, year: 2022 },
  { id: "c3", title: "気が合うと思ってた", artist: "隠れ敬語", album: "折れ曲がった漫画", duration: 227, cover: coverC, trackNumber: 3, year: 2022 },
];

// Original placeholder lyric lines (not real lyrics).
const LYRICS_A1: [number, string, string][] = [
  [0, "夜明け前のプラットホーム", "黎明前的站台"],
  [9, "風がページをめくる", "风翻动着页码"],
  [18, "言いかけて やめた言葉", "欲言又止的话语"],
  [27, "ポケットで丸くなる", "在口袋里蜷成一团"],
  [36, "縫い目は夜のあかし", "缝线是夜的印记"],
  [45, "ほどけないまま でいい", "就这样不解开也好"],
  [54, "君の声の周波数", "你声音的频率"],
  [63, "今も耳の奥で鳴る", "如今仍在耳深处回响"],
  [72, "改札を抜けたなら", "若穿过检票口"],
  [81, "振り返らない約束", "便约定不再回头"],
  [90, "袖口のほつれさえ", "连袖口的磨损"],
  [99, "愛おしく思えた", "也曾觉得可爱"],
  [108, "真夜中は短い", "深夜如此短暂"],
  [117, "だから ここで歌う", "所以我在此歌唱"],
  [126, "名前のないメロディー", "没有名字的旋律"],
  [135, "口ずさみ 歩く", "哼着它前行"],
  [144, "街灯のオルゴール", "街灯的八音盒"],
  [153, "同じ曲を繰り返す", "重复着同一首歌"],
  [162, "飽きないふりをして", "假装不曾厌倦"],
  [171, "本当は好きなんだ", "其实是喜欢的啊"],
  [180, "縫い目をなぞる指", "抚过缝线的手指"],
  [189, "夜を数えている", "细数着夜晚"],
  [198, "朝が来るまでに", "在清晨到来之前"],
  [207, "もう一度だけ歌う", "再唱一次就好"],
];

const POOL: [string, string][] = [
  ["窓辺の影が伸びる", "窗边的影子拉长"],
  ["コーヒーは冷めたまま", "咖啡一直凉着"],
  ["予定表の余白に", "在日程表的空白处"],
  ["小さな船を描く", "画下一只小船"],
  ["返事のない質問", "没有回音的提问"],
  ["天井で跳ね返る", "在天花板上弹回"],
  ["それでも悪くない", "即便如此也不坏"],
  ["今日は今日でいい", "今天这样就好"],
  ["電車の揺れの中で", "在电车的摇晃中"],
  ["まぶたが船を漕ぐ", "眼皮划动着小船"],
  ["降りる駅を過ぎて", "错过了下车站"],
  ["少しだけ遠くへ", "稍微去远一点"],
];

function generated(id: string): [number, string, string][] {
  const seed = id.charCodeAt(0) + id.charCodeAt(1);
  return POOL.map(([jp, zh], i) => [i * 9 + (seed % 5), jp, zh]);
}

export function mockLyrics(trackId: string): LyricState {
  if (trackId === "c3") return { kind: "none" };
  if (trackId === "b2")
    return {
      kind: "plain",
      text: POOL.map(([jp, zh]) => `${jp}\n${zh}`).join("\n\n"),
    };
  const lines = trackId === "a1" ? LYRICS_A1 : generated(trackId);
  return {
    kind: "synced",
    lines: lines.map(([time, text, translation]) => ({ time, text, translation })),
  };
}
