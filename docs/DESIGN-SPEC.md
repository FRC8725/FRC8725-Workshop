# Workshop Dark SPA 設計與實作規範

> 本文件是一份可交給 AI 或開發者直接執行的設計規格。目標是在不同功能的專案中，重現本系統的版面結構、深色視覺語言、互動密度、響應式行為與原生 JavaScript SPA 架構，而不是複製工作室管理功能本身。

## 1. 設計目標

設計應呈現「專業、務實、資訊密集但不擁擠」的深色管理工具風格：

- 使用固定側邊欄承載品牌、主要路由與帳號資訊。
- 頁面切換只更新右側內容，側邊欄與應用程式狀態保持不變。
- 採暖紅色作為主要操作色，狀態色只用於傳達語意。
- 大面積背景保持接近黑色，使用多層灰色表面建立層級。
- 預設使用緊湊列表；卡片只用於需要較完整資訊或視覺預覽的內容。
- 動畫短而克制，避免裝飾性長動畫。
- 所有互動元件必須提供鍵盤 focus、文字標示與響應式處理。

## 2. 技術與架構限制

預設技術：HTML5、CSS3、原生 JavaScript、ES Modules、JSON 設定檔，不依賴 UI 框架。

```text
project/
├── index.html                 # 唯一完整 HTML；固定應用程式外殼
├── pages/                     # Router 載入的 HTML fragments
│   ├── home.html
│   ├── detail.html
│   └── users.html
├── js/
│   ├── core/                  # main、router、shell、全域初始化
│   ├── services/              # API、Authentication、資料存取
│   ├── pages/                 # 每個 route 的 mountPage 控制器
│   ├── ui/                    # Modal、Toast、表單、renderer
│   └── utils/                 # 純函式與通用工具
├── css/
│   ├── theme.css              # Design tokens
│   ├── layout.css             # Shell、側欄、主內容、breakpoints
│   ├── components.css         # 共用元件
│   └── <feature>.css          # 個別頁面樣式
├── config/                    # 可由使用者調整的 JSON
└── images/
    └── icons/                 # 外部 SVG 向量圖示
```

架構原則：

1. `index.html` 只建立固定 Shell，不包含特定功能頁面的完整內容。
2. Router 使用 Hash route，例如 `#/home`、`#/detail?id=123`。
3. Router fetch `pages/*.html` 後，只替換 `#page-outlet`。
4. 每個頁面控制器匯出 `mountPage(context)`；如有全域 listener，回傳 cleanup function。
5. 全域服務只初始化一次。頁面切換不得重複初始化 Authentication、API client 或資料庫。
6. CSS 依序載入：`theme → layout → components → feature styles`。
7. 可變標籤、色彩、摘要與資料映射優先放入 JSON，不硬編碼在 renderer。

## 3. 應用程式 Shell

```html
<div class="app">
  <nav class="side-nav" aria-label="主導覽">
    <div class="brand">...</div>
    <div class="nav-group" id="primary-nav"></div>
    <div class="nav-spacer"></div>
    <div id="account-host"></div>
  </nav>
  <main class="main" id="page-outlet" aria-live="polite"></main>
</div>
```

桌面版：

- `.app`：`display:flex; min-height:100vh`。
- `.side-nav`：寬 `260px`、高 `100vh`、`position:sticky; top:0`。
- `.main`：填滿剩餘空間，`min-width:0`，padding `28px 32px 60px`。
- 側欄背景與卡片同色，但用右邊框和主背景分離。
- 帳號資訊固定在側欄底部，名稱與 Email 必須完整換行，不使用省略號。

行動版（≤768px）：

- `.app` 改成直向。
- 側欄改為頂部橫向導覽：寬 `100%`、高自動、取消 sticky。
- 導覽可水平捲動，連結文字不可換行。
- 主內容 padding 改為 `18px 16px 48px`。

## 4. 色彩系統

所有顏色必須透過 CSS custom properties 使用。不可在元件中散落近似色。

### 4.1 基礎與主色

| Token | 色碼 | 用途 |
|---|---:|---|
| `--cffy-theme-light-a0` | `#ffffff` | 主要文字、深色按鈕上的文字 |
| `--cffy-theme-dark-a0` | `#000000` | 淺色危險按鈕文字 |
| `--cffy-theme-primary-a0` | `#c6543d` | 主要按鈕、active 導覽、關鍵數字 |
| `--cffy-theme-primary-a10` | `#ce6651` | Primary hover |
| `--cffy-theme-primary-a20` | `#d57864` | 強調邊框 |
| `--cffy-theme-primary-a30` | `#dc8977` | 次級暖紅文字 |
| `--cffy-theme-primary-a40` | `#e29a8a` | 淺強調 |
| `--cffy-theme-primary-a50` | `#e8ab9d` | 最淺暖紅 |

### 4.2 表面層級

| Token | 色碼 | 用途 |
|---|---:|---|
| `--cffy-theme-surface-a0` | `#121212` | 網站主背景、輸入框背景 |
| `--cffy-theme-surface-a10` | `#252525` | 側欄、卡片、Modal |
| `--cffy-theme-surface-a20` | `#393939` | 卡片內層、次要按鈕、選取區 |
| `--cffy-theme-surface-a30` | `#4f4f4f` | 邊框、hover 表面 |
| `--cffy-theme-surface-a40` | `#666666` | 較弱文字、scrollbar hover |
| `--cffy-theme-surface-a50` | `#7d7d7d` | 次要文字 |

表面使用順序：`主背景 a0 → 卡片 a10 → 卡片內部 a20 → 邊框 a30`。不要用陰影取代所有邊框。

### 4.3 狀態色

| 狀態 | 主色 | 淺色 |
|---|---:|---:|
| Success | `#7dff95` | `#9dffac` |
| Warning | `#ffbc5e` | `#ffca83` |
| Danger | `#ff8080` | `#ff9b99` |
| Info | `#87d1ff` | `#a1dbff` |

狀態背景使用主色約 `10%–15%` alpha，邊框約 `35%` alpha。不可用狀態色作大面積背景。

### 4.4 語意 aliases

```css
--bg: var(--cffy-theme-surface-a0);
--nav-bg: var(--cffy-theme-surface-a10);
--card-bg: var(--cffy-theme-surface-a10);
--card-bg-alt: var(--cffy-theme-surface-a20);
--border: var(--cffy-theme-surface-a30);
--border-soft: var(--cffy-theme-surface-a20);
--text: var(--cffy-theme-light-a0);
--text-muted: var(--cffy-theme-surface-a50);
--text-dim: var(--cffy-theme-surface-a40);
--primary: var(--cffy-theme-primary-a0);
--primary-hover: var(--cffy-theme-primary-a10);
```

## 5. 字體與文字層級

```css
--font: "Segoe UI", "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif;
```

- Body：`15px / 1.5`。
- Page title：`26px`、weight `800`；手機 `22px`。
- Modal title：`17px`、weight `700`。
- 一般 item name：`13–14px`、weight `700`。
- Card section title：`13px`、weight `700`、letter-spacing `0.04em`、uppercase。
- 次要文字：`12–14px`，使用 `--text-muted`。
- metadata：`10–11.5px`，使用 `--text-dim`。
- 中文文字不可強制 uppercase；uppercase 僅影響拉丁字母。

## 6. 尺寸、間距與圓角

基準間距為 4px 的倍數，常用值為 `6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32px`。

```css
--radius-sm: 6px;
--radius: 10px;
--radius-lg: 14px;
--gap: 16px;
--shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
```

- 一般按鈕、輸入框：`radius-sm`。
- 列表 row、內層項目：`radius`。
- 主要卡片、Modal：`radius-lg`。
- 卡片 padding：通常 `18px`；緊湊列表 `7px 10px` 或 `12px 14px`。
- 同級卡片間距：`16px`；主要欄位間距：`20px`。

## 7. 核心元件規格

### 7.1 卡片

```css
.card {
  background: var(--card-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  padding: 18px;
}
```

卡片內再分層時使用 `--card-bg-alt`，不要再建立更深的陰影。

### 7.2 按鈕

- 高度由 `padding: 9px 16px` 形成。
- 字級 `14px`、weight `600`。
- Primary：暖紅背景、白字。
- Danger：淡紅背景、黑字，只用於不可逆操作。
- Ghost：透明背景、灰色邊框。
- Icon button：固定 `36×36px`。
- Disabled：opacity `0.55`，cursor `not-allowed`。
- `:focus-visible` 必須使用 2px Info 色 outline。

### 7.3 表單

- 背景 `surface-a0`，邊框 `--border`。
- padding `9px 11px`，radius `6px`。
- Focus 使用 primary 邊框與 `rgba(198,84,61,.25)` 外光。
- Label `12.5px/600`，使用 muted 色。
- 錯誤文字 `12px`、Danger 色。
- 雙欄 `.form-row` 在 ≤480px 改為單欄。

### 7.4 Badge 與 Chip

- Badge 使用 pill：`border-radius:999px`。
- 字級約 `11.5px/700`。
- 狀態 badge 使用淡色透明背景與同色文字。
- Chip 可互動時需有 hover 邊框，不可只靠顏色表示可點擊。

### 7.5 列表

列表是預設資料呈現形式：

- Row 背景 `card-bg-alt`。
- 邊框 `border-soft`，radius `6px`。
- padding `7px 10px`，row gap `6px`。
- 名稱使用 `13px/700`。
- metadata 使用 `11–12px` muted 色。
- 操作按鈕靠右；窄螢幕允許換行。
- Hover 只改邊框為 primary，不大幅改背景。
- 被定位或高亮的 row 使用 Warning 邊框與兩層光暈。

### 7.6 Modal

- Overlay：黑色 60% alpha。
- Modal 最大寬度 `560px`、最大高度 `90vh`。
- Header 與 footer sticky，背景必須不透明。
- 開啟動畫約 `150ms`，位移不超過 `8px`。
- 手機 ≤480px 時 Modal 全螢幕且取消圓角。

### 7.7 Toast

- 固定於右上角 `18px`，最大寬 `340px`。
- 使用 4px 左邊框表示狀態。
- 進出動畫約 `200ms`。
- 手機時左右各保留 `12px`，寬度自適應。

## 8. 首頁與資訊面板排版

桌面首頁使用三欄：

```css
grid-template-columns: 340px minmax(0, 1fr) 290px;
gap: 20px;
```

- 左欄：搜尋、篩選、結果。
- 中欄：主要視覺或核心工作區。
- 右欄：摘要與狀態。
- 左右欄桌面可 sticky，top `20px`。
- ≤1200px 改為兩欄，摘要跨全欄且取消 sticky，避免覆蓋內容。
- ≤768px 改為單欄，所有 sticky 取消。
- 只有內部結果區捲動，不讓搜尋控制列被推出畫面。

摘要 tiles 建議使用兩欄小 Grid，數字 `24px/800`，標題 `12px` muted。顯示內容與顏色應由 JSON 設定，不應硬編碼。

## 9. 導覽與圖示

- 導覽列 row padding `10px 12px`、gap `12px`。
- 一般狀態 muted；hover 使用 `card-bg-alt` 與白字；active 只將文字與圖示改成 primary。
- 圖示固定 `18×18px`。
- 所有向量圖形存放於 `images/icons/*.svg`，不得在 HTML 或 JavaScript 內嵌 path。
- 使用 CSS mask 讓外部 SVG 跟隨 `currentColor`：

```css
.ico-svg {
  display: inline-block;
  background-color: currentColor;
  mask: var(--icon-url) center / contain no-repeat;
}
```

## 10. 響應式斷點

| Breakpoint | 行為 |
|---:|---|
| `>1200px` | 三欄首頁、左右 sticky、固定 260px 側欄 |
| `≤1200px` | 兩欄首頁、摘要跨欄、搜尋欄取消 sticky |
| `≤768px` | 單欄內容、側欄改頂部橫向導覽 |
| `≤480px` | Header 垂直排列、表單單欄、Modal 全螢幕 |

不要只縮小字體。優先改變 Grid 欄數、解除 sticky、允許 action row 換行。

## 11. 狀態與互動

- Loading：26px spinner，邊框灰色，頂部 primary。
- Empty：置中、padding `34px 20px`，提供標題與下一步說明。
- Error：使用 Danger banner，但不可顯示原始 stack trace。
- Focus：所有按鈕、連結、卡片與輸入框需可見。
- Hover transition：`120–150ms`。
- 不以 hover 作為唯一資訊來源；觸控與鍵盤必須可完成相同操作。
- 刪除前必須顯示確認 Modal，說明影響範圍。

## 12. JSON 驅動設定

以下內容優先由 JSON 管理：

- 類型、狀態、標籤及顏色。
- 摘要 tiles、順序、filter 與顏色。
- 頁面中的實體結構或區域座標。
- 可由非程式開發者調整的文案與選項。

JSON 僅描述資料，不允許包含可執行 JavaScript。Renderer 必須驗證顏色與欄位，未知值使用安全預設。

## 13. AI 實作指令範本

可將以下內容連同本文件交給 AI：

```text
請依照 DESIGN-SPEC.md 建立一個原生 HTML/CSS/ES Modules 的深色 SPA。
保留固定 260px 側邊欄，只替換 #page-outlet；使用 Hash Router 與 pages/*.html fragments。
嚴格使用 theme tokens，不自行發明近似色。預設資料呈現使用緊湊列表。
將 JavaScript 分成 core、services、pages、ui、utils；每個頁面匯出 mountPage(context)，並清理全域 listeners。
所有 SVG 圖示必須是 images/icons 下的外部檔案並以 CSS mask 顯示。
響應式行為必須符合 1200/768/480px 三個斷點。
功能與資料模型可以不同，但 Shell、色彩、間距、元件密度和互動規則必須遵循此文件。
```

## 14. 驗收清單

- [ ] 根目錄只有一個完整 `index.html` 應用程式入口。
- [ ] 路由切換不 reload，側邊欄與 session 保持。
- [ ] CSS 使用本文件的 token 與語意 aliases。
- [ ] 桌面側欄為 260px，手機改為頂部橫向導覽。
- [ ] 首頁遵循 340px／彈性／290px 三欄比例。
- [ ] 卡片、按鈕、輸入框、Badge、Modal 和 Toast 符合尺寸規格。
- [ ] 預設資料檢視為列表。
- [ ] 1200px 以下沒有 sticky 元素覆蓋後續內容。
- [ ] 768px 以下所有主要內容為單欄。
- [ ] 所有操作具有 hover、focus、disabled 與錯誤狀態。
- [ ] 所有 SVG 是外部資產，不在 HTML／JavaScript 內嵌 path。
- [ ] 可調整的標籤、色彩與摘要使用 JSON。
- [ ] 頁面控制器能在離開 route 時清理全域事件與 observer。

