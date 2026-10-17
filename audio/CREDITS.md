# 音樂來源與授權

本資料夾內所有音樂皆為**真實樂器錄音**，非合成、非 AI 生成。

## 曲目

| 檔案 | 曲目 | 對應關卡 | 原始錄音 |
| --- | --- | --- | --- |
| `menu-qiufengci.mp3` | 秋風詞 | 標題畫面 | [Qiu Feng Ci.ogg](https://commons.wikimedia.org/wiki/File:Qiu_Feng_Ci.ogg) |
| `chapter1-qiufengci.mp3` | 秋風詞 | 第一關 風煙俱淨 | 同上 |
| `chapter2-pingsha.mp3` | 平沙落雁 | 第二關 奇山異水 | [Pingsha Luoyan.ogg](https://commons.wikimedia.org/wiki/File:Pingsha_Luoyan.ogg) |
| `chapter3-liushui.mp3` | 流水 | 第三關 水皆縹碧 | [Liu Shui.ogg](https://commons.wikimedia.org/wiki/File:Liu_Shui.ogg) |
| `chapter4-jiukuang.mp3` | 酒狂 | 第四關 鳶飛戾天 | [Jiu Kuang.ogg](https://commons.wikimedia.org/wiki/File:Jiu_Kuang.ogg) |

## 錄音者

**Charlie Huang**，古琴，錄於英國伯明翰 Shaoyun Xuan，2006 年 4 月 15 日。
樂譜出自《楳盦珡諩》（1931）等古琴譜本。

## 授權

**Creative Commons Attribution 2.5（CC BY 2.5）**
<https://creativecommons.org/licenses/by/2.5/>

可自由使用、修改、商用、再散布，條件是必須保留以下署名：

> 曲目：秋風詞／平沙落雁／流水／酒狂
> 錄音：Charlie Huang，經由 Wikimedia Commons 提供
> 授權：CC BY 2.5 — creativecommons.org/licenses/by/2.5

遊戲內「音樂與版權」頁面即為此署名。

## 本專案做過的處理

原始錄音為 Ogg Vorbis、44.1 kHz、單聲道、長度 1:46 至 8:13。為了讓網頁版遊戲能離線載入且循環播放，做了以下處理：

1. **裁切片段**：每首取 48–95 秒。裁切點盡量落在音量較低的樂句間隙（以 RMS 包絡找出局部最低點）。
2. **響度統一**：`loudnorm` 至 −20 LUFS、True Peak −2 dB，並加 55 Hz 高通濾波去除房間低頻隆隆聲。
3. **重新編碼**：MP3、44.1 kHz、單聲道、64 kbps（原始素材為單聲道且殘響很重，64 kbps 已無可聞劣化）。
4. **循環淡化**：不改音檔本身，改由 `src/audio.js` 在播放時做 3.5 秒等功率（cos/sin）交叉淡化，讓接縫聽不出來。

演奏內容、音色、演奏者一律未動。

## 換成自己的音樂

把 mp3 或 ogg 丟進 `audio/music/`，然後改 `src/audio.js` 裡的 `TRACKS`：

```js
const TRACKS = {
  menu: { file: "my-music.mp3", title: "曲目名", credit: "演奏者" },
  1: { file: "my-music.mp3", title: "曲目名", credit: "演奏者" },
  // ...
};
```

支援 mp3、ogg、wav、m4a（瀏覽器解得開就行）。檔名對得上就行，不必改其他地方。
超過 4 分鐘的曲子會讓解碼吃比較多記憶體，建議先裁到 2 分鐘以內。