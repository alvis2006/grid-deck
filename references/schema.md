# deck.json 格式

```jsonc
{
  "version": 1,
  "meta": { "title": "簡報名稱", "author": "", "stage": "draft", "createdAt": "…", "updatedAt": "…" },
  // stage: draft → static-confirmed（確認排版）→ animated（確認動畫）
  "canvas": { "width": 1920, "height": 1080 },          // 固定
  "grid": { "size": 60, "snap": true, "show": true },    // 編輯器偏好
  "theme": { "name": "paper", "overrides": { "accent": "#E4572E", "fontHeading": "serif" } },
  "transition": { "effect": "fade", "duration": 500 },   // 預設轉場
  "slides": [ /* Slide */ ]
}
```

## Slide

```jsonc
{
  "id": "s1abc",
  "name": "封面",                 // 縮圖下的名稱
  "layout": "cover",              // 只是紀錄用，不影響渲染
  "notes": "講稿",                 // 播放時按 N 顯示
  "skip": false,                  // true = 播放與匯出時隱藏
  "background": { "color": "bg", "image": "assets/bg.jpg", "fit": "cover", "dim": 0.3 },
  "transition": { "effect": "slide", "duration": 600 },   // 選填，覆蓋預設
  "elements": [ /* Element，陣列後面的在上層 */ ],
  "build": [ /* 動畫步驟 */ ]
}
```

## Element 共有欄位

| 欄位 | 說明 |
|---|---|
| `id` | 同一頁內不可重複 |
| `type` | `text` `shape` `image` `chart` `table` |
| `name` | 選填，顯示在圖層清單與動畫窗格 |
| `x` `y` `w` `h` | 畫布座標（px），是旋轉前的外框 |
| `rotate` | 角度，順時針，以中心旋轉 |
| `opacity` | 0–1 |
| `locked` | true = 編輯器裡不能拖曳 |
| `hidden` | true = 不顯示（編輯器裡以半透明顯示） |

## text

```jsonc
{
  "type": "text",
  "text": "第一行<br>第二行有 <span class=\"hl\">重點</span>",
  "style": {
    "font": "heading",        // heading | body | mono
    "size": 64, "weight": 800, "italic": false,
    "color": "text",          // 主題色名稱或 #hex
    "align": "left",          // left | center | right | justify
    "valign": "top",          // top | middle | bottom
    "lineHeight": 1.2, "letterSpacing": 0.02,   // letterSpacing 單位 em
    "list": "bullet",         // 選填：bullet | number（每一行是一個項目）
    "paraSpacing": 0.4,       // 行與行（項目與項目）之間的距離，單位 em
    "fill": "surface", "padding": 32, "radius": 24, "stroke": "line", "strokeWidth": 2
  }
}
```

可以用的行內標記只有：`<br>`、`<b>`、`<i>`、`<u>`，以及帶下列 class 的 `<span>`：`hl` 主色、`hl2` 輔色、`hl3` 點綴色、`mu` 淡色、`mark` 螢光底、`sm` 0.42 倍小字。其他標籤或屬性會被移除。

## shape

```jsonc
{ "type": "shape", "shape": "rect", "style": { "fill": "accent", "stroke": null, "strokeWidth": 0, "radius": 24, "dash": "solid" } }
```

`shape`：`rect` | `ellipse` | `triangle` | `line`。`line` 用 `stroke`（沒有時用 `fill`）和 `strokeWidth` 在框的垂直中央畫一條線，斜線就用 `rotate`。

## image

```jsonc
{ "type": "image", "src": "assets/photo.jpg", "alt": "", "style": { "fit": "cover", "position": "center", "radius": 24, "stroke": null, "strokeWidth": 0 } }
```

`src` 是相對於 deck 資料夾的路徑，圖片要放在 `assets/`。空字串會顯示「圖片」佔位框。匯出時圖片會內嵌進 HTML。

## chart

```jsonc
{
  "type": "chart",
  "style": { "size": 24 },          // 標籤字級，其他字依比例
  "chart": {
    "kind": "bar",                  // bar 直條 | hbar 橫條 | line 折線 | donut 圓環
    "labels": ["Q1", "Q2", "Q3"],
    "series": [ { "name": "營收", "values": [10, 14, 18], "color": "accent" } ],
    "unit": "%", "prefix": "$",     // 數值標籤的前後綴
    "showValues": true, "showLegend": false,
    "highlight": 2,                 // 單一系列時強調第幾項（從 0 起算），其他變淡
    "max": 100, "min": 0,           // 選填，軸的範圍
    "area": true,                   // 只有 line：畫面積
    "centerLabel": "180", "centerSub": "每週合計"   // 只有 donut
  }
}
```

donut 只會用第一個系列；顏色依序取 accent、accent2、accent3、muted、text，可以用 `series[0].colors` 指定。

## table

```jsonc
{ "type": "table", "style": { "size": 26 }, "table": { "header": true, "rows": [["", "A", "B"], ["成本", "低", "高"]], "highlightCol": 1, "align": ["left", "center", "center"] } }
```

儲存格可以使用和文字相同的行內標記。表格會平均撐滿元素的高度。

## build（動畫步驟）

```jsonc
{ "id": "元素 id", "effect": "rise", "trigger": "click", "delay": 0, "duration": 600 }
```

時間計算：`click` 會開啟新的一步，從 `delay` 開始；`with` 的開始時間＝上一個的開始時間＋`delay`；`after` 的開始時間＝上一個的結束時間＋`delay`。第一個 `click` 之前的步驟在進頁（轉場結束）後自動播放。同一個元素只會用第一次出現的設定。

## 主題色

| 名稱 | 用途 |
|---|---|
| `bg` | 頁面背景 |
| `surface` | 卡片、面板 |
| `text` | 主要文字 |
| `muted` | 次要文字 |
| `line` | 線條、分隔、軸線 |
| `accent` `accent2` `accent3` | 主色、輔色、點綴 |

`theme.overrides` 可以覆蓋任何一個主題色，也可以設 `fontHeading`／`fontBody`（`sans`、`serif`，或完整的 CSS font-family 字串）。
