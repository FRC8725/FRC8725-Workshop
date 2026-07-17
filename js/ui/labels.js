// js/labels.js
//
// 狀態、類型與標籤的定義集中在 config/labels.json，
// 格式為 { name, color, label }。此模組負責載入並提供查詢 / 產生徽章的函式。

import { loadJSON, el, hexToRgba } from "../utils/utils.js";

const LABELS_PATH = "config/labels.json";

// 當 labels.json 載入失敗時使用的後備定義，確保頁面不崩潰。
const FALLBACK = {
  statuses: [
    { name: "available", color: "#7dff95", label: "可用" },
    { name: "in-use", color: "#ffbc5e", label: "使用中" },
    { name: "maintenance", color: "#87d1ff", label: "維修中" },
    { name: "missing", color: "#ff8080", label: "找不到" },
    { name: "unavailable", color: "#ff8080", label: "不可用" },
  ],
  categories: [
    { name: "tool", color: "#87d1ff", label: "工具" },
    { name: "material", color: "#e29a8a", label: "材料" },
  ],
  tags: [],
};

let cache = null;
let statusMap = new Map();
let categoryMap = new Map();
let tagMap = new Map();

function buildMaps() {
  statusMap = new Map((cache.statuses || []).map((d) => [d.name, d]));
  categoryMap = new Map((cache.categories || []).map((d) => [d.name, d]));
  tagMap = new Map((cache.tags || []).map((d) => [d.name, d]));
}

/** Load labels config once. Must be awaited before rendering. */
export async function initLabels() {
  if (cache) return cache;
  try {
    cache = await loadJSON(LABELS_PATH);
    if (!cache.statuses) cache.statuses = FALLBACK.statuses;
    if (!cache.categories) cache.categories = FALLBACK.categories;
    if (!cache.tags) cache.tags = [];
  } catch (err) {
    console.warn("labels.json 載入失敗，使用後備定義。", err);
    cache = FALLBACK;
  }
  buildMaps();
  return cache;
}

/* ---------------- lookups ---------------- */

export function statusList() { return cache?.statuses || FALLBACK.statuses; }
export function categoryList() { return cache?.categories || FALLBACK.categories; }
export function tagList() { return cache?.tags || []; }

export function statusDef(name) {
  return statusMap.get(name) || { name, color: "#7d7d7d", label: name || "未知" };
}
export function categoryDef(name) {
  return categoryMap.get(name) || { name, color: "#7d7d7d", label: name || "" };
}
export function tagDef(name) {
  return tagMap.get(name) || { name, color: "#7d7d7d", label: name };
}

/* ---------------- badge / chip builders ---------------- */

/** Generic coloured badge element (colour comes from JSON hex). */
export function makeBadge(text, color, { dot = true } = {}) {
  const span = el("span", { class: dot ? "badge" : "badge badge-plain" }, text);
  span.style.color = color;
  span.style.background = hexToRgba(color, 0.15);
  return span;
}

/** Tool status badge, driven by labels.json. */
export function statusBadge(status) {
  const d = statusDef(status);
  return makeBadge(d.label, d.color, { dot: true });
}

/** Category tag (rounded rect, no dot). */
export function categoryTag(category) {
  const d = categoryDef(category);
  const span = el("span", { class: "cat-tag" }, d.label);
  span.style.color = d.color;
  span.style.background = hexToRgba(d.color, 0.18);
  return span;
}

/**
 * Tag chip coloured by its JSON definition.
 * @param {string} name
 * @param {{removable?:boolean, onRemove?:Function}} opts
 */
export function tagChip(name, { removable = false, onRemove } = {}) {
  const d = tagDef(name);
  const chip = el("span", { class: removable ? "chip" : "chip static" }, `#${d.label}`);
  chip.style.color = d.color;
  chip.style.borderColor = hexToRgba(d.color, 0.5);
  chip.style.background = hexToRgba(d.color, 0.12);
  if (removable) {
    const x = el("span", { class: "x", role: "button", "aria-label": `移除標籤 ${d.label}` }, "×");
    if (onRemove) x.addEventListener("click", () => onRemove(name));
    chip.appendChild(x);
  }
  return chip;
}
