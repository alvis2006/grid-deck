---
name: grid-deck
description: 網格排版簡報工作流：確認大綱 → 確認排版方向與樣稿 → 製作與確認完整靜態簡報（使用編輯器）→ 製作與確認動態效果 → 最終導出 HTML 與 PDF。這是使用者偏好的做簡報方式：只要使用者要做簡報、投影片、PPT、slides、deck、提案、報告簡報，或提到網格調整、自己排版、拖曳元素、移動旋轉、簡報動畫、匯出 HTML／PDF，都優先用這個 skill。只有使用者明確要「可編輯 .pptx 檔」或指定 dashi／guizang 風格時才改用其他 skill。
---

# Grid Deck（網格簡報）

一份簡報 = 一個資料夾，核心是 `deck.json`。Claude 寫 JSON，使用者在本機網頁編輯器裡用網格調整，兩邊改的都是同一個檔案：編輯器自動存檔，Claude 改檔案時，開著的編輯器會立刻同步。

```
<deck>/
  deck.json      ← 唯一的資料來源
  outline.json   ← 已確認的大綱（階段 1 整理，階段 3 製作使用）
  assets/        ← 圖片
  versions/      ← 版本快照（確認靜態稿／確認動畫／手動存檔）
  exports/       ← 匯出的 HTML、PDF、截圖
```

Skill 根目錄記為 `<skill>`（本檔所在資料夾）。所有指令都用 Node 18+，不需要安裝套件：

```bash
node <skill>/scripts/gd.mjs new <deck> --outline <deck>/outline.json [--force]
node <skill>/scripts/gd.mjs serve <deck> [--port 5610] [--open]   # 要用背景執行
node <skill>/scripts/gd.mjs validate <deck>
node <skill>/scripts/gd.mjs shots <deck> [--slides 1,3]           # 每頁 PNG → exports/shots/
node <skill>/scripts/gd.mjs snapshot <deck> --label 靜態稿確認 --stage static-confirmed
node <skill>/scripts/gd.mjs export <deck> --formats html,pdf
```

PDF 和截圖會用電腦上的 Chrome 或 Edge 在背景產生，找不到時可以設定 `GD_BROWSER` 環境變數。


## 執行環境與共同編輯

- 本技能繼續以 Claude 為使用對象；保留原本的 `deck.json`、CLI 與網頁編輯器格式，不需要額外套件。
- 開始製作時確認 Node 18+；PDF／截圖另需 Chrome 或 Edge。指令中的路徑都加引號，尤其含空白或中文時。先讀 [references/schema.md](references/schema.md)，再直接編輯 deck.json。
- 本機 Claude 可啟動常駐編輯器；若在遠端或雲端執行，`127.0.0.1` 指向該執行環境，不代表使用者電腦。不要宣稱使用者已能開啟；交付簡報資料夾並提供在本機執行的指令。背景啟動依當前系統的工具進行，避免阻塞整個對話。
- 改檔前讀取最新內容；保留頁面與元素 id，僅修改相關欄位。重要改動前使用 snapshot；不以 `gd new --force` 取代既有排版。
- 編輯器會合併不同頁的修改；同頁或設定衝突時由使用者選擇。出現衝突、未儲存或同步中時，先處理狀態再確認排版、還原或匯出。不要繞過衝突直接覆蓋檔案。
- 靜態版與動畫版的確認是使用者的選擇；沒有明確確認就維持目前 stage。若使用者要直接交付，完成可完成的匯出並說明實際驗證範圍。
- 交付前檢查實際檔案；無法執行瀏覽器時，明確標示未驗證 PDF／截圖，不能以結構檢查代替視覺確認。

## 五個階段

依序確認：**內容 → 視覺方向 → 完整靜態稿 → 動畫 → 成品**。每階段先提供具體可審閱的結果，再請使用者確認；沿用已明確確認的決定，不重複詢問。除非使用者明確授權跳過或合併階段，不提前製作整份簡報或動畫。

| 階段 | Claude 提供 | 使用者確認 |
|---|---|---|
| 1 確認簡報大綱 | 頁數、逐頁標題、重點內容、敘事順序 | 內容範圍與順序 |
| 2 確認排版方向 | 配色、字體、封面及代表內容頁樣稿 | 視覺風格與資訊配置 |
| 3 製作與確認靜態簡報 | 完整靜態稿、本機編輯器 | 逐頁文字、圖片、位置與大小 |
| 4 製作與確認動態效果 | 動畫方案、實作及預覽 | 順序、觸發方式、節奏與效果 |
| 5 最終導出 | HTML、簡報者畫面及靜態 PDF | 交付成品 |

### 階段 1：確認簡報大綱

- 整理使用者提供的講稿與資料，提出總頁數及逐頁清單：頁碼、標題、核心訊息、內容重點、所需圖片或數據。缺失資料明確標示，不虛構。
- 頁數未指定時依內容建議，通常 8–12 頁；先呈現具體大綱，再等待內容確認，不直接開始整份排版。
- 確認後保存 outline.json；後續使用相同內容製作，重大增刪頁或改變敘事順序時只重新確認受影響部分。
- 資料夾以使用者指定位置優先；否則放在目前專案，或 `~/Documents/grid-deck/<英文短名>/`。

### 階段 2：確認排版方向

- 依已確認的大綱提出配色、字體、資訊層級與圖片風格，製作封面及 1–2 張代表內容頁的靜態樣稿，讓使用者看到實際效果。
- 可用主題：`paper` 紙白、`mono` 極簡白、`forest` 森綠、`ink` 墨黑、`navy` 深藍；品牌色用 themeOverrides。
- 樣稿放在獨立的樣稿資料夾，避免縮減或覆蓋完整 outline.json。跑 validate、shots 並查看圖片後交給使用者確認。
- 此處確認的是整體排版方向，尚未確認完整靜態稿，不設定 `static-confirmed`。記錄已接受的風格與樣稿，接著才製作全部頁面。

### 階段 3：製作與確認靜態簡報

1. 依已確認的大綱與樣稿製作所有頁面；首次建立可用 `gd new`，再依樣稿調整 deck.json。既有簡報直接修改，保留頁面與元素 id，不用 `new --force` 覆蓋使用者的排版。
2. 此時先完成靜態內容，不加入入場動畫；講稿放在 notes。跑 `gd validate` 修正錯誤，跑 `gd shots` 並逐張查看文字溢出、重疊、數字與圖片，修正後再次檢查。
3. 背景啟動 `node "<skill>/scripts/gd.mjs" serve "<deck>" --open`，從輸出取得實際網址。遵守上方執行環境限制；Windows PowerShell 可用 `Start-Process "<url>"` 開啟。
4. 提供編輯器網址與操作提示：拖曳移動、拉角縮放、上方圓點旋轉、雙擊改字、Alt 暫停吸附、`?` 看快捷鍵；頁面／屬性／講稿面板可收合。
5. 使用者在編輯器微調時，Claude 每次改檔先讀最新 deck.json，只改相關欄位並保留所有 id。同步衝突先處理，不覆蓋尚未保存的修改。
6. 使用者確認完整靜態稿後，按「✓ 確認靜態稿」，或執行 `gd snapshot "<deck>" --label 靜態稿確認 --stage static-confirmed`。這份版本作為動畫製作基準。

### 階段 4：製作與確認動態效果

- 先提出可審閱的動畫方案：每頁元素的出現順序、點擊或自動觸發、效果與節奏，以及頁面轉場。等待方向確認後實作；使用者已指定的動畫方案不必重問。
- 讀取最新 deck.json，依方案寫每頁 build：標題可進頁自動出現（after／with），逐點講解用 click，數字可用 count，圖表用 grow，圖片用 fade／zoom。少而一致，保留已確認的靜態排版。
- 讓使用者在「動畫」分頁按「預覽本頁」或「播放」檢查；依回饋調整，方案確認不等於最終動畫確認。
- 使用者滿意後按「✓ 確認動畫」，或執行 `gd snapshot "<deck>" --label 動畫確認 --stage animated`。
- 若返回修改內容或排版，保留既有版本，重新確認受影響的靜態內容與動畫，再交付；不要把舊確認當作新版本已獲同意。

### 階段 5：最終導出

- `gd export <deck> --formats html,pdf`，或使用者在編輯器裡按「匯出」。
- HTML 會產生兩個單一檔案（簡報資料夾內的圖片會包在裡面；HTTP 圖片仍需連線，離線交付前先下載到 assets/ 再引用），要放在同一個資料夾：
  - `<名稱>.html` 觀眾畫面：← → 換頁、空白鍵或點擊播下一步、N 顯示講稿、F 全螢幕。單獨打開就能播。
  - `<名稱>-presenter.html` 簡報者畫面：目前畫面、下一個畫面（本頁下一個動畫或下一頁）、講稿（A−／A+ 調字級）、總計時與本頁計時、時鐘、全部頁面縮圖（點一下跳頁）。按「開啟觀眾畫面」（或 O）開出觀眾視窗，拖到投影幕按 F 全螢幕；之後在任一視窗操作（鍵盤、翻頁筆、點擊）兩邊都會同步。B 或 . 黑屏、T 開始／暫停計時。
- PDF 每頁一張 1920×1080，內容是動畫播完後的畫面，文字可以選取。
- 匯出後確認 PDF 存在、頁數正確（隱藏的頁面不會匯出）；有疑慮就跑 `gd shots` 看一下。回覆使用者所有檔案的完整路徑。

## outline.json（階段 1 整理，階段 3 製作使用）

```json
{
  "title": "簡報名稱", "author": "作者", "theme": "paper",
  "themeOverrides": { "accent": "#E4572E" },
  "slides": [
    { "layout": "cover", "kicker": "眉標", "title": "主標<br>可以換行", "subtitle": "副標", "meta": "日期／單位", "notes": "講稿" }
  ]
}
```

| layout | 欄位 |
|---|---|
| `cover` 封面 | kicker, title, subtitle, meta |
| `section` 章節頁 | no（如 "02"）, title, subtitle |
| `statement` 標題＋段落 | kicker, title, body |
| `bullets` 條列 | kicker, title, bullets[], note |
| `two-column` 兩欄 | kicker, title, left{heading, body 或 bullets[]}, right{…} |
| `big-number` 大數字 | kicker, value, unit, label, note |
| `stats` 數據卡（1–4 張） | kicker, title, stats[{value, unit, label, desc}] |
| `cards` 文字卡（1–4 張） | kicker, title, cards[{no?, title, body}] |
| `image-text` 圖文 | kicker, title, body, image（assets/ 相對路徑）, imageSide: "left"\|"right" |
| `quote` 引言 | quote, author |
| `timeline` 時間軸（2–6 步） | kicker, title, steps[{label, title, desc}] |
| `chart` 圖表 | kicker, title, chart{…}, insight, insightTitle |
| `table` 表格 | kicker, title, columns[], rows[[]], highlightCol（從 0 起算）, note |
| `closing` 結尾 | title, subtitle, contact |
| `blank` 空白 | — |

每頁都可以加 `notes`（講稿）、`name`（縮圖下的名稱）、`background`（如 `{"color":"accent"}`）。文字欄位可以用行內標記：`<br>` 換行、`<b>` 粗體、`<span class="hl">` 主色、`hl2` 輔色、`hl3` 點綴色、`mu` 淡色、`mark` 螢光底、`sm` 小字（適合放在數字後面當單位）。

## 直接改 deck.json

完整格式見 `references/schema.md`。重點：

- 畫布是 1920×1080 px，網格預設 60 px。座標盡量對齊 60 的倍數，左右邊界 120。
- 元素（`slides[].elements[]`）共有欄位：`id, type, name, x, y, w, h, rotate, opacity, locked, hidden`，陣列順序就是圖層順序（後面的在上層）。
- `type`：`text`（`text` 存 HTML 子集，用 `<br>` 換行；`style`：font heading|body|mono, size, weight, color, align, valign, lineHeight, letterSpacing, paraSpacing, list bullet|number, fill, padding, radius, stroke, strokeWidth）、`shape`（`shape` 可用 rect|ellipse|triangle|line；`style`：fill, stroke, strokeWidth, radius, dash）、`image`（`src`；`style`：fit, position, radius）、`chart`、`table`。
- 顏色可以填主題色名稱（`bg surface text muted line accent accent2 accent3`，換主題會跟著變），或填 `#hex`（固定不變）。
- 新元素的 id 用短亂數字串，例如 `"e" + 8 碼英數`，不可以和同一頁的其他 id 重複。
- 改完跑 `gd validate`，版面有變動就 `gd shots` 看圖確認。

## 動畫（`slides[].build`）

```json
"build": [
  { "id": "<元素 id>", "effect": "rise", "trigger": "after", "delay": 100, "duration": 600 },
  { "id": "<元素 id>", "effect": "rise", "trigger": "with",  "delay": 120, "duration": 600 },
  { "id": "<元素 id>", "effect": "fade", "trigger": "click", "delay": 0,   "duration": 500 }
]
```

- `effect`：fade 淡入、rise 上浮、drop 下落、slide-left 從右滑入、slide-right 從左滑入、zoom 放大、pop 彈出、blur 模糊淡入、wipe-right 向右擦除、wipe-up 向上擦除、spin 旋入、count 數字跳動（只限文字）、grow 圖表生長（只限圖表）。
- `trigger`：`click`＝簡報時按一下才開始（會開啟新的一步）；`with`＝和上一個同時開始，再加上自己的 delay；`after`＝上一個播完才開始。第一個 `click` 之前的步驟會在進頁時自動播放。
- 不在 `build` 裡的元素一進頁就直接顯示。
- 轉場：`deck.transition` 是預設值，`slides[].transition` 可以覆蓋單頁；`effect` 可用 none|fade|slide|zoom|rise，`duration` 單位 ms。

## 疑難排解

- 編輯器打不開：確認 serve 還在背景執行，網址以 serve 輸出的為準。
- 使用者說網頁沒更新：請他重新整理；或檢查 deck.json 是不是合法的 JSON（不合法時伺服器會忽略這次修改）。
- PDF 有空白頁或缺字：先 `gd shots` 看截圖。中文字型依賴系統字型，Windows 會用 Microsoft JhengHei（沒有 Noto Sans TC 時）。
- 要可以編輯的 .pptx：這個 skill 不做，請使用當前 Claude 環境實際可用的 PPTX 技能；沒有可用工具時清楚說明限制，不假設特定外掛已安裝。

## 維護

修改本技能程式時，參考 [references/maintenance.md](references/maintenance.md) 的修正紀錄與測試指令。

## 編輯器工作區

畫布上方的「頁面／屬性／講稿」按鈕可收合各面板。「專注畫布」收起全部面板，「返回編輯」還原進入前的面板配置。畫布自動適合可用空間；筆電與窄螢幕預設收起部分面板，可隨時重新打開。面板顯示只影響編輯器，不改變簡報內容。

## 動畫工作台（試用）

**使用偏好：只有使用者主動明確要求使用動畫工作台時，才啟用或引導使用此工作台。** 一般動畫製作、動畫效果要求或階段 4 的確認，不代表要求使用工作台；預設由 Claude 設計動畫並用原編輯器預覽。使用者主動要求後，可在已啟動的本機服務開啟 `/runtime/workbench.html`，或按編輯器的「動畫工作台」連結。工作台直接讀寫同一份 deck.json，提供元素選取、點擊分組時間軸、入場效果、延遲、時長、速度曲線、順序調整、拖動時間條、播放／暫停、時間滑桿及復原。

工作台採「儲存動畫」手動儲存；遇到其他視窗更新會拒絕舊版本覆蓋。切回編輯器前先儲存並等待同步，不要同時在兩個介面修改。存檔不代表已確認動畫，仍由使用者確認後才 snapshot 為 animated。

一般入場效果可在時間軸即時檢視；計數、圖表生長及自訂場景需用「整頁播放」檢查。退場、自訂移動路徑、同一元素多段動畫與完整關鍵影格尚未支援，不宣稱具備。工作台載入步驟時先顯示該步完成的畫面，按播放會從頭重播。

兩個編輯介面預設採黑色／深色外觀；此設定只影響工具介面，不改變簡報的配色與匯出內容。

文字框在直接輸入、貼上、調整字級／文字樣式或縮窄框時，自動增加高度容納文字；保留寬度與位置。文字與框高屬於同一次操作，可一起復原。刪字後保留原高度，若要收緊空白可用「高度貼合文字」。

靜態編輯器支援畫布右鍵選單：元素上可編輯文字、建立副本、調整圖層、對齊、鎖定、隱藏或刪除；空白處可新增元素。多選後右鍵已選元素會保留多選。文字輸入中保留瀏覽器的文字右鍵選單。
