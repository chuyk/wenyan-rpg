# vendor

此目錄是刻意提交的第三方程式碼，不是散落或遺漏的依賴。

| 檔案 | 內容 | 版本 | 授權 |
| --- | --- | --- | --- |
| `three.module.js` | Three.js ES module 進入點 | r180 | MIT（聲明內嵌於檔頭） |
| `three.core.js` | Three.js 核心 | r180 | MIT（聲明內嵌於檔頭） |

來源：<https://github.com/mrdoob/three.js/tree/r180>

為什麼要放進來：本專案設計成**免建置、免網路**。不使用 CDN，也沒有 npm／打包步驟，
`index.html` 直接以 import map 指向 `./vendor/three.module.js`。如此一來離線、
內網、或沒有安裝 Node.js 的教室電腦都能直接開啟遊戲。

升級方式：從 three.js 各版本 release 下載 `build/three.module.js` 與
`build/three.core.js` 覆蓋本目錄，並更新上表版本號即可。Three.js 從 r160 起
這兩個檔案是分開的，缺一不可。
