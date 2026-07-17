// js/utils/utils.js — shared helpers, constants and small DOM utilities
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

// Vector definitions live in images/icons/. CSS masks keep currentColor support.
const ICON_NAMES = new Set([
  "map", "reset", "book", "search", "box", "alert",
  "info", "check", "x", "edit", "trash", "list", "users",
]);

export function icon(name, { size = "1em", stroke = 2 } = {}) {
  if (!ICON_NAMES.has(name)) return "";
  // --icon-url is consumed by css/layout.css, so the URL is relative to css/.
  return `<span class="ico-svg" style="width:${size};height:${size};--icon-url:url('../images/icons/${name}.svg')" aria-hidden="true"></span>`;
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
