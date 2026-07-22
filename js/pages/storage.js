// js/pages/storage.js — cabinet detail page

import { $, el, escapeHtml, icon, formatLocation, isLowStock, isOutOfStock, inventoryCount, inUseToolCount } from "../utils/utils.js";
import { initLabels, storageTypeLabel } from "../ui/labels.js";
import {
  getAreaById, getStructureById, getItemsByStorageId,
  getAllAreas, getStructures, deleteItem, adjustItemQuantity,
} from "../services/data-service.js";
import { buildLocationIndex, filterItems } from "../utils/search.js";
import { sortByName } from "../utils/item-logic.js";
import { renderStructure } from "../ui/storage-renderer.js";
import { openItemForm } from "../ui/item-form.js";
import { confirmModal } from "../ui/modal.js";
import { notify } from "../ui/notifications.js";
import { firestoreErrorMessage } from "../services/auth-service.js";
import { isDebugMode } from "../core/debug-mode.js";
import { encodeDataMatrixSvg } from "../ui/datamatrix.js";

let state = {
  area: null,
  structure: null,
  items: [],
  index: null,
  query: "",
  highlight: { section: null, item: null },
};

let navigate = null;

export async function mountPage({ params, routeTo }) {
  navigate = routeTo;
  state = {
    area: null, structure: null, items: [], index: null, query: "",
    highlight: { section: null, item: null },
  };
  const storageId = params.get("id");
  state.highlight.section = params.get("section") || null;
  state.highlight.item = params.get("item") || null;

  if (!storageId) { renderError("未指定櫃子", "網址缺少 id 參數。"); return; }

  // section/item are transient navigation hints. Remove them without triggering
  // another route render so later add/edit refreshes cannot reuse the old result.
  if (state.highlight.section || state.highlight.item) {
    history.replaceState(null, "", `#/storage?id=${encodeURIComponent(storageId)}`);
  }

  try {
    const [area, allAreas, structures] = await Promise.all([
      getAreaById(storageId),
      getAllAreas(),
      getStructures(),
      initLabels(),
    ]);

    if (!area) {
      return renderError("找不到櫃子", `找不到 id 為「${escapeHtml(storageId)}」的櫃子。`);
    }
    state.area = area;
    state.index = buildLocationIndex(allAreas, structures);

    const structure = await getStructureById(area.structureId);
    if (!structure) {
      renderHead();
      return renderError("找不到櫃子結構",
        `此櫃子對應的結構「${escapeHtml(area.structureId)}」不存在於 storage-structures.json。`);
    }
    state.structure = structure;

    renderHead();
    wireToolbar();
    wireItemDelegation();
    await refreshItems();
  } catch (err) {
    console.error(err);
    renderError("載入失敗", `${escapeHtml(err.message)}。請確認以 HTTP 伺服器（如 Live Server）開啟。`);
  }
}

function renderHead() {
  const { area, structure } = state;
  document.title = `${area.name} · 培訓室管理`;
  const host = document.getElementById("storage-head");
  host.innerHTML = `
    <div class="storage-title-wrap">
      <div class="storage-meta">
        <button class="btn btn-ghost btn-sm" id="back-home" type="button">← 返回平面圖</button>
      </div>
      <h1 class="page-title" style="margin-top:8px">${escapeHtml(area.name)}</h1>
      <div class="storage-meta">
        <span class="badge badge-info badge-plain">${escapeHtml(storageTypeLabel(area.type))}</span>
        ${structure ? `<span class="badge badge-muted badge-plain">${escapeHtml(structure.name)}</span>` : ""}
      </div>
      <p class="storage-desc">${escapeHtml(area.description || `${area.name} 的存放內容。`)}</p>
    </div>
    <div class="storage-actions">
      ${isDebugMode() ? `<button class="btn btn-ghost" id="export-dm-btn" type="button"><span class="ico-svg" style="width:15px;height:15px;--icon-url:url('../images/icons/clipboard.svg')" aria-hidden="true"></span>輸出 Data Matrix</button>` : ""}
      <button class="btn btn-primary" id="add-item-btn"><span class="ico-svg" style="width:15px;height:15px;--icon-url:url('../images/icons/plus.svg')" aria-hidden="true"></span>新增物品</button>
    </div>
  `;
  host.querySelector("#back-home").addEventListener("click", () => navigate("home"));
  host.querySelector("#add-item-btn").addEventListener("click", () => {
    openItemForm({
      defaults: { storageId: state.area.id, sectionId: state.structure.sections?.[0]?.id },
      onSaved: () => refreshItems(),
    });
  });
  host.querySelector("#export-dm-btn")?.addEventListener("click", (event) => exportDataMatrixPdf(event.currentTarget));
}

function wireToolbar() {
  const input = document.getElementById("storage-search");
  if (input) input.addEventListener("input", () => { state.query = input.value; renderGrid(); });

}

// One delegated handler for edit / delete across all sections (no per-render listeners).
function wireItemDelegation() {
  const host = document.getElementById("structure-host");
  if (!host || host.dataset.wired) return;
  host.dataset.wired = "1";
  host.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !host.contains(btn)) return;
    const wrap = e.target.closest("[data-item-id]");
    const id = wrap?.dataset.itemId;
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    if (btn.dataset.action === "quantity-decrease" || btn.dataset.action === "quantity-increase") {
      handleQuantityAction(btn, item);
    } else if (btn.dataset.action === "edit") {
      openItemForm({ item, onSaved: () => refreshItems() });
    } else if (btn.dataset.action === "delete") {
      handleDelete(item);
    }
  });
}

async function handleQuantityAction(btn, item) {
  const delta = btn.dataset.action === "quantity-increase" ? 1 : -1;
  btn.disabled = true;
  try {
    await adjustItemQuantity(item.id, delta, item);
    notify.success(`${item.category === "tool" ? (delta > 0 ? "已歸還" : "已使用") : (delta > 0 ? "已補充" : "已取用")}「${item.name}」`);
    await refreshItems();
  } catch (err) {
    console.error(err);
    if (err.code === "quantity-empty" || err.code === "quantity-full") notify.warning(err.message);
    else notify.danger("數量更新失敗：" + firestoreErrorMessage(err));
    await refreshItems();
    btn.disabled = false;
  }
}

async function refreshItems() {
  try {
    state.items = await getItemsByStorageId(state.area.id);
  } catch (err) {
    console.error(err);
    notify.danger(firestoreErrorMessage(err));
    state.items = [];
  }
  renderStats();
  renderGrid();
  maybeHighlight();
}

function renderStats() {
  const host = document.getElementById("storage-stats");
  if (!host) return;
  const items = state.items;
  const tools = items.filter((i) => i.category === "tool");
  const materials = items.filter((i) => i.category === "material");
  const toolCount = tools.reduce((sum, item) => sum + inventoryCount(item), 0);
  const inUse = tools.reduce((sum, item) => sum + inUseToolCount(item), 0);
  const low = materials.filter((i) => isLowStock(i) || isOutOfStock(i)).length;

  const tiles = [
    { v: toolCount + materials.length, l: "物品總數" },
    { v: toolCount, l: "工具" },
    { v: materials.length, l: "材料種類" },
    { v: inUse, l: "使用中" },
    { v: low, l: "低存量／缺貨" },
  ];
  host.innerHTML = "";
  for (const t of tiles) {
    host.appendChild(el("div", { class: "mini-stat" },
      el("div", { class: "v" }, String(t.v)),
      el("div", { class: "l" }, t.l),
    ));
  }
}

function renderGrid() {
  const host = document.getElementById("structure-host");
  if (!host) return;
  // 未指定其他排序時，各格內容一律依名稱升冪
  const filtered = sortByName(filterItems(state.items, state.query, state.index));

  renderStructure({
    host,
    structure: state.structure,
    items: filtered,
    ctx: { page: "storage", index: state.index },
    onAdd: (sectionId) => openItemForm({
      defaults: { storageId: state.area.id, sectionId },
      onSaved: () => refreshItems(),
    }),
  });

  if (state.query && filtered.length === 0) {
    host.insertAdjacentHTML("afterbegin",
      `<div class="banner banner-info">此櫃子中沒有符合「${escapeHtml(state.query)}」的物品。</div>`);
  }
}

async function handleDelete(item) {
  const storageName = state.index.storageName(item.storageId);
  const sectionName = state.index.sectionName(item.storageId, item.sectionId);
  const ok = await confirmModal({
    title: "刪除物品",
    message: `確定要刪除「${escapeHtml(item.name)}」嗎？`,
    detail: `位置：${escapeHtml(formatLocation(storageName, sectionName))}。此操作無法復原。`,
    confirmText: "刪除",
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteItem(item.id, item);
    notify.success("已刪除物品");
    await refreshItems();
  } catch (err) {
    console.error(err);
    notify.danger("刪除失敗：" + firestoreErrorMessage(err));
  }
}

function maybeHighlight() {
  const { section, item } = state.highlight;
  if (!section && !item) return;
  // Consume the navigation highlight before any later data refresh can run it again.
  state.highlight = { section: null, item: null };
  // setTimeout (not rAF) so it still runs when the tab is not visible.
  setTimeout(() => {
    let target = null;
    if (section) {
      const cell = document.querySelector(`.section-cell[data-section-id="${CSS.escape(section)}"]`);
      if (cell) { cell.classList.add("highlight"); target = cell; }
    }
    if (item) {
      const card = document.querySelector(`[data-item-id="${CSS.escape(item)}"]`);
      if (card) { card.classList.add("highlight"); target = card; }
    }
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    // clear highlight after a while so it doesn't stay forever
    setTimeout(() => {
      document.querySelectorAll(".highlight").forEach((n) => n.classList.remove("highlight"));
    }, 5000);
  }, 50);
}

/* ---------- 除錯模式：輸出工具 Data Matrix 標籤 PDF ---------- */

let exportingDm = false;

async function exportDataMatrixPdf(button) {
  if (exportingDm) return;
  const structure = state.structure;
  const tools = state.items.filter((item) => item.category === "tool");

  // 依櫃子目前的位置顯示順序分組；每組內依名稱排序；標籤份數 = 總數量。
  const groups = [];
  const seen = new Set();
  for (const section of structure.sections || []) {
    const inSection = sortByName(tools.filter((tool) => tool.sectionId === section.id));
    const labels = [];
    for (const tool of inSection) {
      seen.add(tool.id);
      const total = Math.max(0, Math.floor(Number(tool.totalQuantity ?? tool.quantity) || 0));
      if (total > 0) labels.push({ id: tool.id, count: total });
    }
    if (labels.length) groups.push({ name: section.name, labels });
  }
  // 未對應任何 section 的工具（保險）歸到「其他位置」。
  const orphanTools = sortByName(tools.filter((tool) => !seen.has(tool.id)));
  const orphanLabels = [];
  for (const tool of orphanTools) {
    const total = Math.max(0, Math.floor(Number(tool.totalQuantity ?? tool.quantity) || 0));
    if (total > 0) orphanLabels.push({ id: tool.id, count: total });
  }
  if (orphanLabels.length) groups.push({ name: "其他位置", labels: orphanLabels });

  const totalLabels = groups.reduce((sum, g) => sum + g.labels.reduce((s, l) => s + l.count, 0), 0);
  if (!totalLabels) {
    notify.warning("此櫃子沒有可輸出的工具（工具總數量為 0）。");
    return;
  }

  exportingDm = true;
  if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = "產生中…"; }
  try {
    // 每個不同的 id 只編碼一次，重複使用同一段 SVG。
    const uniqueIds = [...new Set(groups.flatMap((g) => g.labels.map((l) => l.id)))];
    const svgById = new Map();
    for (const id of uniqueIds) svgById.set(id, await encodeDataMatrixSvg(id));

    const groupsHtml = groups.map((group) => {
      const cells = group.labels.map((label) => {
        const svg = svgById.get(label.id);
        return Array.from({ length: label.count }, () => `<div class="dm-cell">${svg}</div>`).join("");
      }).join("");
      return `<section class="dm-group">
        <div class="dm-caption">${escapeHtml(group.name)}</div>
        <div class="dm-grid">${cells}</div>
      </section>`;
    }).join("");

    const popup = window.open("", "_blank");
    if (!popup) {
      notify.warning("瀏覽器阻擋了列印視窗，請允許此網站開啟彈出式視窗。");
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
      <title>${escapeHtml(state.area.name)}－工具 Data Matrix 標籤</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111; font: 10pt/1.4 "Noto Sans TC", Arial, sans-serif; }
        h1 { font-size: 12pt; margin: 0 0 4mm; }
        .dm-group { break-inside: auto; }
        .dm-group + .dm-group {
          margin-top: 4mm; padding-top: 4mm;
          border-top: 0.4mm dashed #444;   /* 群組間可剪裁分隔線 */
        }
        .dm-caption { font-size: 8.5pt; color: #444; margin: 0 0 2mm; }
        .dm-grid { display: flex; flex-wrap: wrap; gap: 2mm; }         /* 2mm 間距即靜區，一致排列 */
        .dm-cell {
          width: 10mm; height: 10mm; flex: 0 0 auto;   /* 實際列印固定 1cm × 1cm */
          break-inside: avoid; page-break-inside: avoid;
        }
        .dm-cell svg { display: block; width: 10mm; height: 10mm; }
        @media screen { body { background:#f4f4f4; } .sheet { background:#fff; max-width:210mm; margin:0 auto; padding:10mm; } }
      </style></head><body><div class="sheet">
        <h1>${escapeHtml(state.area.name)}｜工具 Data Matrix 標籤</h1>
        ${groupsHtml}
      </div><script>
        const printNow = () => setTimeout(() => { window.focus(); window.print(); }, 200);
        if (document.readyState === "complete") printNow();
        else window.addEventListener("load", printNow);
      <\/script></body></html>`);
    popup.document.close();
    notify.success(`已產生 ${totalLabels} 個標籤，請於列印對話框選擇「另存為 PDF」。`);
  } catch (err) {
    console.error(err);
    notify.danger("輸出失敗：" + (err.message || "未知錯誤"));
  } finally {
    exportingDm = false;
    if (button) { button.disabled = false; if (button.dataset.label) button.textContent = button.dataset.label; }
  }
}

function renderError(title, msg) {
  const main = document.getElementById("storage-main");
  if (!main) return;
  main.innerHTML = `
    <div class="error-page">
      <div class="big-ico">${icon("alert", { size: "52px", stroke: 1.6 })}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(msg)}</p>
      <button class="btn btn-primary" id="error-home" type="button">返回平面圖</button>
    </div>
  `;
  main.querySelector("#error-home")?.addEventListener("click", () => navigate("home"));
}
