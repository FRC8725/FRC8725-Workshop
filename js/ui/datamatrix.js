// js/ui/datamatrix.js
//
// Data Matrix 的產生與解碼，統一使用 @zxing/library（純 JS，跨桌面／行動裝置，
// 不依賴瀏覽器原生 BarcodeDetector API）。函式庫以動態 import 延遲載入，
// 只有在「輸出標籤 PDF」或「開啟相機掃描」時才會下載。
//
// 選型理由：ZXing 是維護良好、跨裝置相容性佳、Data Matrix 支援完整的方案，
// 且同一套即可同時做「編碼（產生）」與「解碼（相機辨識）」，避免多套平行依賴。

const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm";
let zxingPromise = null;

export async function loadZXing() {
  if (!zxingPromise) {
    zxingPromise = import(ZXING_URL).catch((err) => {
      zxingPromise = null; // 允許之後重試
      throw Object.assign(new Error("無法載入 Data Matrix 函式庫，請確認網路連線。"), { cause: err });
    });
  }
  return zxingPromise;
}

/**
 * 將文字編碼成 Data Matrix，回傳無失真的 SVG 字串（1 模組 = 1 viewBox 單位）。
 * 呼叫端再以 CSS（如 width/height:10mm）設定實際列印尺寸即可保持清晰。
 */
export async function encodeDataMatrixSvg(text) {
  const ZX = await loadZXing();
  // 直接用 DataMatrixWriter（MultiFormatWriter 在部分打包版本未註冊 DM 編碼器）。
  const writer = new ZX.DataMatrixWriter();
  // width/height 傳 0 → 取得未縮放的模組矩陣（1px = 1 模組）。
  const matrix = writer.encode(String(text), ZX.BarcodeFormat.DATA_MATRIX, 0, 0);
  const w = matrix.getWidth();
  const h = matrix.getHeight();
  let rects = "";
  for (let y = 0; y < h; y += 1) {
    let x = 0;
    while (x < w) {
      if (matrix.get(x, y)) {
        let run = 1;
        while (x + run < w && matrix.get(x + run, y)) run += 1;
        rects += `<rect x="${x}" y="${y}" width="${run}" height="1"/>`;
        x += run;
      } else {
        x += 1;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
    + `shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">`
    + `<rect width="${w}" height="${h}" fill="#ffffff"/>`
    + `<g fill="#000000">${rects}</g></svg>`;
}

/**
 * 啟動相機並持續辨識 Data Matrix。
 * @param {HTMLVideoElement} videoEl
 * @param {(text:string)=>void} onDecode - 每辨識到一次呼叫（去重由呼叫端處理）
 * @param {(err:Error)=>void} [onError]
 * @returns {Promise<{stop:()=>void}>}
 */
export async function createDataMatrixScanner(videoEl, onDecode, onError) {
  const ZX = await loadZXing();
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.DATA_MATRIX]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

  // 連續掃描時「這一幀沒找到條碼」是正常情形，會以例外形式回傳。
  // 打包後類別名稱被壓縮（err.name 變成 "e"），因此改用 instanceof 判斷，
  // 而不是比對 err.name，否則會把正常的 NotFound 誤判成錯誤、洗版 console。
  const benignErrors = [ZX.NotFoundException, ZX.ChecksumException, ZX.FormatException].filter(Boolean);
  const isBenign = (err) => benignErrors.some((Type) => err instanceof Type)
    || /(detect|not\s*found|able to)/i.test(err?.message || "");

  let controls = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    try { controls?.stop?.(); } catch { /* ignore */ }
    try { reader.reset?.(); } catch { /* ignore */ }
    const stream = videoEl?.srcObject;
    if (stream && typeof stream.getTracks === "function") {
      stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
    }
    if (videoEl) videoEl.srcObject = null;
  };

  try {
    controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" } } },
      videoEl,
      (result, err) => {
        if (stopped) return;
        if (result) { onDecode(result.getText()); return; }
        // 只有「非解碼失敗」的真正錯誤才回報，避免每幀誤報。
        if (err && !isBenign(err)) onError?.(err);
      },
    );
  } catch (err) {
    stop();
    throw err;
  }
  return { stop };
}
