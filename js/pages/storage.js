// js/pages/storage.js — cabinet detail page

import { $, el, escapeHtml, icon, formatLocation, isLowStock, isOutOfStock, inventoryCount, inUseToolCount } from "../utils/utils.js";
import { initLabels, storageTypeLabel } from "../ui/labels.js";
import {
  getAreaById, getStructureById, getItemsByStorageId,
  getWorkshopMap, getStructures, deleteItem, updateItem,
} from "../services/data-service.js";
import { buildLocationIndex, filterItems } from "../utils/search.js";
import { renderStructure } from "../ui/storage-renderer.js";
import { getViewMode, setViewMode, renderViewSwitcher } from "../ui/item-view.js";
import { openItemForm } from "../ui/item-form.js";
import { confirmModal } from "../ui/modal.js";
import { notify } from "../ui/notifications.js";
import { firestoreErrorMessage } from "../services/auth-service.js";

let state = {
  area: null,
  structure: null,
  items: [],
  index: null,
  query: "",
  viewMode: getViewMode("storage"),
  highlight: { section: null, item: null },
};

let navigate = null;

export async function mountPage({ params, routeTo }) {
  navigate = routeTo;
  state = {
    area: null, structure: null, items: [], index: null, query: "",
    viewMode: getViewMode("storage"),
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
      getWorkshopMap().then((m) => m.areas || []),
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
      <button class="btn btn-primary" id="add-item-btn">＋ 新增物品</button>
    </div>
  `;
  host.querySelector("#back-home").addEventListener("click", () => navigate("home"));
  host.querySelector("#add-item-btn").addEventListener("click", () => {
    openItemForm({
      defaults: { storageId: state.area.id, sectionId: state.structure.sections?.[0]?.id },
      onSaved: () => refreshItems(),
    });
  });
}

function wireToolbar() {
  const input = document.getElementById("storage-search");
  if (input) input.addEventListener("input", () => { state.query = input.value; renderGrid(); });

  // View mode switcher (card / list)
  const toolbar = document.querySelector(".storage-toolbar");
  if (toolbar && !toolbar.querySelector(".view-mode-switcher")) {
    const switcher = renderViewSwitcher(state.viewMode, (mode) => {
      state.viewMode = mode;
      setViewMode("storage", mode);
      renderGrid();               // re-render with current data — no Firebase reload
    });
    toolbar.appendChild(switcher);
  }
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
  const current = Math.max(0, Number(item.quantity) || 0);
  const total = Math.max(0, Number(item.totalQuantity ?? item.quantity) || 0);
  const quantity = item.category === "tool"
    ? Math.min(total, Math.max(0, current + delta))
    : Math.max(0, current + delta);
  if (quantity === current) return;
  btn.disabled = true;
  try {
    await updateItem(item.id, { quantity });
    notify.success(`${item.category === "tool" ? (delta > 0 ? "已歸還" : "已使用") : (delta > 0 ? "已補充" : "已取用")}「${item.name}」`);
    await refreshItems();
  } catch (err) {
    console.error(err);
    notify.danger("數量更新失敗：" + firestoreErrorMessage(err));
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
  const filtered = filterItems(state.items, state.query, state.index);

  renderStructure({
    host,
    structure: state.structure,
    items: filtered,
    viewMode: state.viewMode,
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
    await deleteItem(item.id);
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
