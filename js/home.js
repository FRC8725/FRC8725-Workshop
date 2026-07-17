// js/home.js — floor-plan overview + global search

import { $, el, escapeHtml, icon, isLowStock, isOutOfStock, debounce } from "./utils.js";
import { initChrome, renderModeBanner } from "./app.js";
import { getItems, getWorkshopMap, getStructures } from "./data-service.js";
import { buildLocationIndex, filterItems } from "./search.js";
import {
  computeAreaStats, renderHotspots, setSearchHighlight, clearSearchHighlight,
} from "./map-renderer.js";
import { initLabels } from "./labels.js";
import {
  getViewMode, setViewMode, renderViewSwitcher, renderItems,
} from "./item-view.js";
import { isCalibrateMode, enableCalibrate } from "./map-calibrate.js";
import { notify } from "./notifications.js";
import { openItemForm } from "./item-form.js";

let state = {
  items: [],
  areas: [],
  structures: [],
  index: null,
  filter: "all", // all | tool | material | low
  query: "",
  viewMode: getViewMode("search"),
};

const hotspotHost = () => document.getElementById("map-hotspots");

async function boot() {
  initChrome();
  renderModeBanner(document.getElementById("mode-banner"));

  wireSearch();
  wireFilters();
  wireViewSwitcher();
  wireResultsDelegation();
  setupFit();
  $("#add-item-btn")?.addEventListener("click", () => {
    openItemForm({ onSaved: () => refreshData() });
  });

  await loadAll();
}

async function loadAll() {
  const mapPanel = document.getElementById("map-status");
  try {
    const [map, structures] = await Promise.all([getWorkshopMap(), getStructures(), initLabels()]);
    state.areas = map.areas || [];
    state.structures = structures;
    state.index = buildLocationIndex(state.areas, state.structures);

    const img = document.getElementById("workshop-map-image");
    if (img) {
      if (map.mapImage) img.src = map.mapImage;
      img.addEventListener("load", fitLayout);
      img.addEventListener("error", () => {
        mapPanel.innerHTML = `<div class="banner banner-danger">平面圖載入失敗：${escapeHtml(map.mapImage)}</div>`;
      });
    }
    await refreshData();
  } catch (err) {
    console.error(err);
    if (mapPanel) mapPanel.innerHTML =
      `<div class="banner banner-danger">設定載入失敗：${escapeHtml(err.message)}。請確認以 HTTP 伺服器（如 Live Server）開啟，而非直接用 file:// 開啟。</div>`;
  }
}

async function refreshData() {
  try {
    state.items = await getItems();
  } catch (err) {
    console.error(err);
    notify.danger("物品資料載入失敗");
    state.items = [];
  }
  renderMap();
  renderSummary();
  renderResults();
  fitLayout();
}

function renderMap() {
  const host = hotspotHost();
  if (!host) return;
  const stats = computeAreaStats(state.items);
  renderHotspots({
    host,
    areas: state.areas,
    stats,
    onOpen: (area) => {
      window.location.href = `storage.html?id=${encodeURIComponent(area.id)}`;
    },
  });

  if (isCalibrateMode()) {
    const mapEl = document.querySelector(".workshop-map");
    if (mapEl) enableCalibrate(mapEl, host, state.areas);
  }
}

function renderSummary() {
  const host = document.getElementById("summary-stats");
  if (!host) return;
  const items = state.items;
  const tools = items.filter((i) => i.category === "tool");
  const materials = items.filter((i) => i.category === "material");
  const inUse = tools.filter((i) => i.status === "in-use").length;
  const wishlist = tools.filter((i) => i.status === "wishlist").length;
  const low = materials.filter((i) => isLowStock(i) || isOutOfStock(i)).length;

  host.innerHTML = "";
  const tiles = [
    { v: items.length, l: "物品總數", cls: "accent" },
    { v: tools.length, l: "工具", cls: "" },
    { v: materials.length, l: "材料", cls: "" },
    { v: inUse, l: "使用中工具", cls: "warn" },
    { v: wishlist, l: "願望清單", cls: "" },
    { v: low, l: "低存量／缺貨", cls: "danger" },
  ];
  const grid = el("div", { class: "stat-grid" });
  for (const t of tiles) {
    grid.appendChild(el("div", { class: `stat ${t.cls}` },
      el("div", { class: "stat-val" }, String(t.v)),
      el("div", { class: "stat-label" }, t.l),
    ));
  }
  host.appendChild(grid);
}

/* ---------------- search + results ---------------- */

function wireSearch() {
  const input = document.getElementById("global-search");
  if (!input) return;
  input.addEventListener("input", () => {
    state.query = input.value;
    renderResults();
  });
}

function wireFilters() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderResults();
    });
  });
}

function wireViewSwitcher() {
  const host = document.getElementById("search-view-switcher");
  if (!host) return;
  host.innerHTML = "";
  host.appendChild(renderViewSwitcher(state.viewMode, (mode) => {
    state.viewMode = mode;
    setViewMode("search", mode);
    renderResults();          // re-render with current data — keeps query/filter, no reload
    fitLayout();
  }));
}

function applyFilter(items) {
  switch (state.filter) {
    case "tool": return items.filter((i) => i.category === "tool");
    case "material": return items.filter((i) => i.category === "material");
    case "low": return items.filter((i) => isLowStock(i) || isOutOfStock(i));
    default: return items;
  }
}

function currentResults() {
  let results = filterItems(state.items, state.query, state.index);
  return applyFilter(results);
}

function renderResults() {
  const host = document.getElementById("result-list");
  const countEl = document.getElementById("result-count");
  if (!host) return;

  const results = currentResults();
  if (countEl) countEl.textContent = String(results.length);

  if (state.items.length === 0) {
    host.className = "result-list";
    host.innerHTML = "";
    host.appendChild(stateBlock("box", "尚無物品", "點擊右上角「新增物品」開始建立。"));
    fitLayout();
    return;
  }
  if (results.length === 0) {
    host.className = "result-list";
    host.innerHTML = "";
    host.appendChild(stateBlock("search", "沒有符合的結果", "試試其他關鍵字或清除篩選。"));
    fitLayout();
    return;
  }

  host.classList.add("result-list");
  renderItems(results, state.viewMode, host, { page: "search", index: state.index });
  fitLayout();
}

/* Delegated handlers on the results container — attached once, survive re-renders. */
function wireResultsDelegation() {
  const host = document.getElementById("result-list");
  if (!host || host.dataset.wired) return;
  host.dataset.wired = "1";

  const itemFrom = (target) => {
    const wrap = target.closest("[data-item-id]");
    if (!wrap || !host.contains(wrap)) return null;
    return state.items.find((i) => i.id === wrap.dataset.itemId) || null;
  };

  host.addEventListener("click", (e) => {
    const item = itemFrom(e.target);
    if (item) openLocation(item);
  });
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const wrap = e.target.closest("[data-item-id]");
    if (!wrap) return;
    e.preventDefault();
    const item = state.items.find((i) => i.id === wrap.dataset.itemId);
    if (item) openLocation(item);
  });

  // Hover / focus → highlight the matching hotspot on the map (bidirectional link)
  const onEnter = (e) => {
    const wrap = e.target.closest("[data-storage-id]");
    if (!wrap || !host.contains(wrap)) return;
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return; // moving within same item
    if (wrap.dataset.storageId) setSearchHighlight(wrap.dataset.storageId);
  };
  const onLeave = (e) => {
    const wrap = e.target.closest("[data-storage-id]");
    if (!wrap || !host.contains(wrap)) return;
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return; // still within same item
    if (wrap.dataset.storageId) clearSearchHighlight(wrap.dataset.storageId);
  };
  host.addEventListener("mouseover", onEnter);
  host.addEventListener("mouseout", onLeave);
  host.addEventListener("focusin", onEnter);
  host.addEventListener("focusout", onLeave);
}

function openLocation(item) {
  const url = `storage.html?id=${encodeURIComponent(item.storageId)}`
    + `&section=${encodeURIComponent(item.sectionId || "")}`
    + `&item=${encodeURIComponent(item.id)}`;
  window.location.href = url;
}

function stateBlock(iconName, title, msg) {
  return el("div", { class: "state-block" },
    el("span", { class: "ico", html: icon(iconName, { size: "34px", stroke: 1.6 }) }),
    el("div", { class: "st-title" }, title),
    el("div", { class: "st-msg" }, msg),
  );
}

/* ---------------- viewport fit (map + results) ---------------- */

function setMaxH(node, px) {
  const val = px > 0 ? `${Math.round(px)}px` : "";
  if (node.style.maxHeight !== val) node.style.maxHeight = val;
}

function fitMap() {
  const wrapper = document.querySelector(".workshop-map-wrapper");
  const mapEl = document.querySelector(".workshop-map");
  const img = document.getElementById("workshop-map-image");
  if (!wrapper || !mapEl || !img) return;

  if (window.innerWidth <= 768) {          // mobile: allow natural size + scroll
    setMaxH(mapEl, 0);
    setMaxH(img, 0);
    return;
  }
  const rect = wrapper.getBoundingClientRect();
  const card = wrapper.closest(".map-panel");
  const legend = card ? card.querySelector(".map-legend") : null;
  const below = (legend ? legend.offsetHeight : 0) + 54; // legend + card/wrapper padding + breathing
  const avail = Math.max(240, window.innerHeight - rect.top - below);
  setMaxH(mapEl, avail);
  setMaxH(img, avail);
}

function fitResults() {
  const list = document.getElementById("result-list");
  if (!list) return;
  if (window.innerWidth <= 768) {          // mobile: use a portion of the viewport
    setMaxH(list, Math.round(window.innerHeight * 0.6));
    return;
  }
  const rect = list.getBoundingClientRect();
  const avail = Math.max(180, window.innerHeight - rect.top - 28);
  setMaxH(list, avail);
}

function fitLayout() {
  fitMap();
  fitResults();
}

function setupFit() {
  const debounced = debounce(fitLayout, 100);
  window.addEventListener("resize", debounced);
  if (typeof ResizeObserver !== "undefined") {
    const main = document.querySelector(".main");
    if (main) new ResizeObserver(debounced).observe(main);
  }
}

document.addEventListener("DOMContentLoaded", boot);
