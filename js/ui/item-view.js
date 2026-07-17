// js/item-view.js
//
// 共用的物品渲染邏輯：卡片模式 / 列表模式、模式切換元件、模式偏好（localStorage）。
// 櫃子詳細頁與首頁搜尋結果都使用這裡的渲染函式，避免重複程式碼。
//
// 兩種模式共用：狀態文字、數量格式化、標籤、位置格式化、圖片錯誤處理、
// 編輯/刪除/開啟操作（以 data-action 屬性搭配事件委派）、Hover 高亮所需的 data 屬性。

import { el, icon, isLowStock, isOutOfStock, formatLocation, formatDateTime } from "../utils/utils.js";
import { statusBadge, categoryTag, tagChip } from "./labels.js";

const PLACEHOLDER = "images/placeholder-item.svg";

/* ---------------- view mode persistence ---------------- */

const VIEW_KEYS = {
  // v2 resets the former card default once, while preserving future user choices.
  storage: "workshop-storage-view-mode-v2",
  search: "workshop-search-view-mode-v2",
};
const DEFAULT_VIEW = { storage: "list", search: "list" };

export function getViewMode(page) {
  try {
    const v = localStorage.getItem(VIEW_KEYS[page]);
    if (v === "card" || v === "list") return v;
  } catch { /* ignore */ }
  return DEFAULT_VIEW[page] || "list";
}

export function setViewMode(page, mode) {
  if (mode !== "card" && mode !== "list") return;
  try { localStorage.setItem(VIEW_KEYS[page], mode); } catch { /* ignore */ }
}

/* ---------------- shared formatters ---------------- */

/** Status badge (tool) or quantity line (material). Shared by both modes/pages. */
export function statusOrQty(item) {
  if (item.category === "tool") return statusBadge(item.status);
  const q = Number(item.quantity);
  const unit = item.unit || "";
  if (isOutOfStock(item)) {
    return el("span", { class: "qty-line qty-out" }, `缺貨（0 ${unit}）`);
  }
  const wrap = el("span", { class: "qty-line" },
    el("span", { class: "qty-num" }, Number.isFinite(q) ? `約 ${q}` : "—"),
    ` ${unit}`,
  );
  if (isLowStock(item)) {
    wrap.classList.add("qty-low");
    wrap.appendChild(el("span", { class: "badge badge-warning", style: "margin-left:8px" }, "低存量"));
  }
  return wrap;
}

function locationText(item, ctx, { full = true } = {}) {
  const idx = ctx.index;
  const storageName = idx ? idx.storageName(item.storageId) : item.storageId;
  const sectionName = idx ? idx.sectionName(item.storageId, item.sectionId) : item.sectionId;
  if (ctx.page === "storage" && !full) return sectionName || "（未指定位置）";
  return formatLocation(storageName, sectionName) || "未分類";
}

function itemThumb(item, cls) {
  const img = el("img", { class: cls, src: item.imageUrl || PLACEHOLDER, alt: "", loading: "lazy" });
  img.addEventListener("error", () => {
    if (img.dataset.fallback) return;
    img.dataset.fallback = "1";
    img.src = PLACEHOLDER;
  });
  return img;
}

function applyDataAttrs(node, item) {
  node.dataset.storageId = item.storageId || "";
  node.dataset.sectionId = item.sectionId || "";
  node.dataset.itemId = item.id || "";
}

/** Action buttons carry data-action; pages wire them via event delegation. */
function actionButtons(item, ctx) {
  const wrap = el("div", { class: "item-actions" });
  if (ctx.page === "search") {
    wrap.appendChild(el("button", {
      class: "btn btn-ghost btn-sm", type: "button", "data-action": "open",
      "aria-label": `開啟 ${item.name} 的位置`,
    }, "開啟位置"));
  } else {
    wrap.appendChild(el("button", {
      class: "icon-btn", type: "button", "data-action": "edit", title: "編輯",
      "aria-label": `編輯 ${item.name}`, html: icon("edit", { size: "15px" }),
    }));
    wrap.appendChild(el("button", {
      class: "icon-btn danger", type: "button", "data-action": "delete", title: "刪除",
      "aria-label": `刪除 ${item.name}`, html: icon("trash", { size: "15px" }),
    }));
  }
  return wrap;
}

/* ---------------- card mode ---------------- */

export function renderItemCard(item, ctx) {
  const card = el("div", { class: "item-card" });
  applyDataAttrs(card, item);
  if (ctx.page === "search") {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${item.name}，位於 ${locationText(item, ctx)}`);
  }

  const body = el("div", { class: "item-card-body" });

  body.appendChild(el("div", { class: "item-top" },
    el("div", { class: "item-name" }, item.name),
    actionButtons(item, ctx),
  ));

  body.appendChild(el("div", { class: "item-sub" }, categoryTag(item.category), statusOrQty(item)));

  body.appendChild(el("div", { class: "item-loc" },
    el("span", { class: "item-loc-ico", html: icon("map", { size: "13px" }) }),
    locationText(item, ctx),
  ));

  if (item.description) {
    body.appendChild(el("div", { class: "item-desc" }, item.description));
  }

  if (Array.isArray(item.tags) && item.tags.length) {
    const tags = el("div", { class: "tag-list item-tags" });
    for (const t of item.tags) tags.appendChild(tagChip(t));
    body.appendChild(tags);
  }

  if (ctx.page === "storage") {
    const u = formatDateTime(item.updatedAt);
    if (u) body.appendChild(el("div", { class: "item-updated" }, `最後更新：${u}`));
  }

  // storage cards show a thumbnail; search panel stays compact without one
  if (ctx.page === "storage") {
    const media = el("div", { class: "item-card-media" }, itemThumb(item, "item-thumb"));
    card.append(media, body);
    card.classList.add("has-media");
  } else {
    card.append(body);
  }
  return card;
}

/* ---------------- list mode ---------------- */

export function renderItemListRow(item, ctx) {
  const row = el("div", { class: "item-list-row" });
  applyDataAttrs(row, item);
  if (ctx.page === "search") {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${item.name}，位於 ${locationText(item, ctx)}`);
  }

  row.appendChild(el("span", { class: "row-cat" }, categoryTag(item.category)));
  row.appendChild(el("span", { class: "row-name", title: item.name }, item.name));
  row.appendChild(el("span", { class: "row-status" }, statusOrQty(item)));
  row.appendChild(el("span", { class: "row-loc", title: locationText(item, ctx) },
    locationText(item, ctx, { full: ctx.page === "search" })));

  const firstTag = Array.isArray(item.tags) ? item.tags[0] : null;
  const tagCell = el("span", { class: "row-tag" });
  if (firstTag) tagCell.appendChild(tagChip(firstTag));
  row.appendChild(tagCell);

  row.appendChild(actionButtons(item, ctx));
  return row;
}

/* ---------------- unified entry points ---------------- */

/** Render a single item in the given mode. */
export function renderItem(item, viewMode, ctx) {
  return viewMode === "list" ? renderItemListRow(item, ctx) : renderItemCard(item, ctx);
}

/**
 * Render a flat list of items into a container (used by search results).
 * Sets container view classes so CSS can lay out card vs list.
 */
export function renderItems(items, viewMode, container, ctx) {
  container.classList.add("items-container");
  container.classList.toggle("view-card", viewMode === "card");
  container.classList.toggle("view-list", viewMode === "list");
  container.dataset.page = ctx.page;
  container.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(renderItem(it, viewMode, ctx));
  container.appendChild(frag);
}

/* ---------------- view mode switcher ---------------- */

/**
 * Build a card/list switcher. Calls onChange(mode) when a button is clicked.
 * @returns {HTMLElement}
 */
export function renderViewSwitcher(current, onChange) {
  const wrap = el("div", { class: "view-mode-switcher", role: "group", "aria-label": "物品顯示方式" });
  const defs = [
    { mode: "card", label: "卡片", ic: "box" },
    { mode: "list", label: "列表", ic: "list" },
  ];
  for (const d of defs) {
    const active = d.mode === current;
    const btn = el("button", {
      type: "button",
      class: "view-mode-button" + (active ? " is-active" : ""),
      "data-view-mode": d.mode,
      "aria-pressed": active ? "true" : "false",
    },
      el("span", { class: "vm-ico", html: icon(d.ic, { size: "15px" }) }),
      el("span", {}, d.label),
    );
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") return;
      wrap.querySelectorAll(".view-mode-button").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      onChange(d.mode);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}
