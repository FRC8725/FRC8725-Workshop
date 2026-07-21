// js/item-view.js
//
// 櫃子詳細頁與首頁搜尋結果共用的物品列表 renderer。
// 集中處理狀態、數量、標籤、位置與 data-action 操作。

import { el, icon, isLowStock, isOutOfStock, formatLocation } from "../utils/utils.js";
import { formatMaterialQuantity } from "../utils/item-logic.js";
import { statusBadge, categoryTag, tagChip } from "./labels.js";

/* ---------------- shared formatters ---------------- */

/** Status and quantity display shared by both pages. */
export function statusOrQty(item) {
  const q = Number(item.quantity);
  if (item.category === "tool") {
    const total = item.totalQuantity == null ? NaN : Number(item.totalQuantity);
    const available = Number.isFinite(q) ? q : 0;
    const totalCount = Number.isFinite(total) ? total : available;
    return el("span", { class: "tool-state" },
      statusBadge(item.status),
      el("span", { class: "qty-line" }, `${available}/${totalCount}`),
    );
  }
  const unit = item.unit || "";
  if (isOutOfStock(item)) {
    return el("span", { class: "qty-line qty-out" }, `缺貨（0${unit}）`);
  }
  const wrap = el("span", { class: "qty-line" },
    el("span", { class: "qty-num" }, formatMaterialQuantity(item)),
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

function applyDataAttrs(node, item) {
  node.dataset.storageId = item.storageId || "";
  node.dataset.sectionId = item.sectionId || "";
  node.dataset.itemId = item.id || "";
}

/**
 * Action buttons carry data-action; pages wire them via event delegation.
 * 借用工具與取用材料只在「作業」頁進行。這裡僅保留材料的「補充」快速按鈕，
 * 不再提供工具的使用／歸還與材料的取用快速按鈕。
 */
function actionButtons(item, ctx) {
  const wrap = el("div", { class: "item-actions" });
  if (item.category === "material") {
    wrap.appendChild(el("button", {
      class: "btn btn-primary btn-sm quick-quantity", type: "button", "data-action": "quantity-increase",
      "aria-label": `補充一個 ${item.name}`,
    }, "補充"));
  }
  if (ctx.page !== "search") {
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

/* ---------------- item row ---------------- */

export function renderItem(item, ctx) {
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
    el("span", { class: "row-loc-text" }, locationText(item, ctx, { full: ctx.page === "search" }))));

  const firstTag = Array.isArray(item.tags) ? item.tags[0] : null;
  const tagCell = el("span", { class: "row-tag" });
  if (firstTag) tagCell.appendChild(tagChip(firstTag));
  row.appendChild(tagCell);

  row.appendChild(actionButtons(item, ctx));
  return row;
}

/**
 * Render a flat list of items into a container (used by search results).
 * Sets the page context used by responsive list styling.
 */
export function renderItems(items, container, ctx) {
  container.classList.add("items-container");
  container.classList.add("view-list");
  container.dataset.page = ctx.page;
  container.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(renderItem(it, ctx));
  container.appendChild(frag);
}
