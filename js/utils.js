// js/utils.js — shared helpers, constants and small DOM utilities
//
// 狀態 / 類型 / 標籤的定義已移至 config/labels.json，由 js/labels.js 管理。

export const UNITS = ["個", "顆", "支", "片", "公尺", "公斤", "包", "盒", "捲", "瓶", "條"];

/** Convert a #rrggbb (or #rgb) hex colour to an rgba() string. */
export function hexToRgba(hex, alpha = 1) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return `rgba(125,125,125,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Inline SVG icons (no emoji). Return SVG markup sized to 1em. ----
const ICON_PATHS = {
  map: '<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z"/><path d="M9 3v16"/><path d="M15 5v16"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z"/><path d="M4 15h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
};

export function icon(name, { size = "1em", stroke = 2 } = {}) {
  const body = ICON_PATHS[name] || "";
  return `<svg class="ico-svg" width="${size}" height="${size}" viewBox="0 0 24 24" `
    + `fill="none" stroke="currentColor" stroke-width="${stroke}" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Escape text for safe insertion into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Normalise text for case-insensitive, trimmed comparison. */
export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Simple id generator for locally created items. */
export function generateId(prefix = "item") {
  const rand = Math.floor(performance.now() * 1000) % 100000;
  return `${prefix}-${rand.toString(36)}-${(counter++).toString(36)}`;
}
let counter = 0;

/** Fetch + parse JSON with a clear error. */
export async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`載入失敗 (${res.status})：${path}`);
  return res.json();
}

/** Debounce a function by `wait` ms. */
export function debounce(fn, wait = 120) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, wait);
  };
}

/** Format an updatedAt value (ISO string / Firestore Timestamp / {seconds}) to "YYYY-MM-DD HH:mm". */
export function formatDateTime(value) {
  if (!value) return "";
  let d;
  if (typeof value === "string" || typeof value === "number") d = new Date(value);
  else if (typeof value.toDate === "function") { try { d = value.toDate(); } catch { return ""; } }
  else if (typeof value.seconds === "number") d = new Date(value.seconds * 1000);
  else return "";
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** querySelector shorthands. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element with attributes + children. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** True when a material is at/below its minimum quantity (but not zero). */
export function isLowStock(item) {
  if (item.category !== "material") return false;
  const q = Number(item.quantity);
  const min = Number(item.minimumQuantity);
  if (!Number.isFinite(q) || !Number.isFinite(min)) return false;
  return q > 0 && q <= min;
}

export function isOutOfStock(item) {
  return item.category === "material" && Number(item.quantity) === 0;
}

/** Build a human location string: "工具櫃 A → A2 抽屜". */
export function formatLocation(storageName, sectionName) {
  const parts = [storageName, sectionName].filter(Boolean);
  return parts.join(" → ");
}
