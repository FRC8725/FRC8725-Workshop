// js/pages/home.js — floor-plan overview + global search

import { $, el, escapeHtml, icon, isLowStock, isOutOfStock, debounce, inventoryCount, inUseToolCount } from "../utils/utils.js";
import { getItems, getWorkshopMap, getStructures, getSummaryStatsConfig, adjustItemQuantity } from "../services/data-service.js";
import { buildLocationIndex, filterItems } from "../utils/search.js";
import {
  computeAreaStats, renderHotspots, setSearchHighlight, clearSearchHighlight,
} from "../ui/map-renderer.js";
import { initLabels } from "../ui/labels.js";
import {
  getViewMode, setViewMode, renderViewSwitcher, renderItems,
} from "../ui/item-view.js";
import { isCalibrateMode, enableCalibrate } from "../ui/map-calibrate.js";
import { notify } from "../ui/notifications.js";
import { openItemForm } from "../ui/item-form.js";
import { firestoreErrorMessage } from "../services/auth-service.js";

let state = {
  items: [],
  areas: [],
  structures: [],
  index: null,
  filter: "all", // all | tool | material | low
  query: "",
  viewMode: getViewMode("search"),
  summaryStats: [],
};

const hotspotHost = () => document.getElementById("map-hotspots");

let navigate = null;

export async function mountPage({ routeTo }) {
  navigate = routeTo;
  state = {
    items: [], areas: [], structures: [], index: null,
    filter: "all", query: "", viewMode: getViewMode("search"), summaryStats: [],
  };

  wireSearch();
  wireFilters();
  wireViewSwitcher();
  wireResultsDelegation();
  const cleanupFit = setupFit();
  $("#add-item-btn")?.addEventListener("click", () => {
    openItemForm({ onSaved: () => refreshData() });
  });

  await loadAll();
  return cleanupFit;
}

async function loadAll() {
  const mapPanel = document.getElementById("map-status");
  try {
    const [map, structures, summaryStats] = await Promise.all([
      getWorkshopMap(), getStructures(), getSummaryStatsConfig(), initLabels(),
    ]);
    state.areas = map.areas || [];
    state.structures = structures;
    state.summaryStats = summaryStats;
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
    notify.danger(firestoreErrorMessage(err));
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
      navigate("storage", { id: area.id });
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
  host.innerHTML = "";
  const grid = el("div", { class: "stat-grid" });
  for (const config of state.summaryStats.filter((entry) => entry.enabled !== false)) {
    const filter = config.filter || {};
    const value = items.reduce((sum, item) => sum + summaryContribution(item, filter), 0);
    const color = validCssColor(config.color) ? config.color : "var(--text)";
    grid.appendChild(el("div", { class: "stat stat-configured", style: `--stat-color:${color}` },
      el("div", { class: "stat-val" }, String(value)),
      el("div", { class: "stat-label" }, config.label || config.id || "未命名"),
    ));
  }
  host.appendChild(grid);
}

function summaryContribution(item, filter) {
  if (filter.category === "tool" && filter.status === "in-use") {
    if (item.category !== "tool") return 0;
    return inUseToolCount(item);
  }
  if (!matchesSummaryFilter(item, filter)) return 0;
  return inventoryCount(item);
}

function matchesSummaryFilter(item, filter) {
  if (filter.category && item.category !== filter.category) return false;
  if (filter.status && item.status !== filter.status) return false;
  if (Array.isArray(filter.tags) && !filter.tags.every((tag) => item.tags?.includes(tag))) return false;
  if (filter.stock) {
    const requested = Array.isArray(filter.stock) ? filter.stock : [filter.stock];
    const stock = isOutOfStock(item) ? "out" : isLowStock(item) ? "low" : "normal";
    if (!requested.includes(stock)) return false;
  }
  return true;
}

function validCssColor(value) {
  return typeof value === "string" && CSS.supports("color", value);
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

  host.addEventListener("click", async (e) => {
    const item = itemFrom(e.target);
    if (!item) return;
    const btn = e.target.closest("[data-action]");
    if (btn?.dataset.action === "quantity-decrease" || btn?.dataset.action === "quantity-increase") {
      e.stopPropagation();
      const delta = btn.dataset.action === "quantity-increase" ? 1 : -1;
      btn.disabled = true;
      try {
        await adjustItemQuantity(item.id, delta);
        notify.success(`${item.category === "tool" ? (delta > 0 ? "已歸還" : "已使用") : (delta > 0 ? "已補充" : "已取用")}「${item.name}」`);
        await refreshData();
      } catch (err) {
        console.error(err);
        if (err.code === "quantity-empty" || err.code === "quantity-full") notify.warning(err.message);
        else notify.danger("數量更新失敗：" + firestoreErrorMessage(err));
        await refreshData();
        btn.disabled = false;
      }
      return;
    }
    if (!btn) openLocation(item);
  });
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("[data-action]")) return;
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
  navigate("storage", {
    id: item.storageId,
    section: item.sectionId || "",
    item: item.id,
  });
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
  let viewportWidth = window.innerWidth;
  const onResize = () => {
    const nextWidth = window.innerWidth;
    // Mobile browser chrome changes innerHeight while scrolling. Refit only
    // when the layout width changes, otherwise the map visibly stretches.
    if (Math.abs(nextWidth - viewportWidth) < 2) return;
    viewportWidth = nextWidth;
    debounced();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", debounced);
  let observer = null;
  if (typeof ResizeObserver !== "undefined") {
    const main = document.querySelector(".main");
    if (main) {
      let mainWidth = main.getBoundingClientRect().width;
      observer = new ResizeObserver((entries) => {
        const nextWidth = entries[0]?.contentRect.width ?? mainWidth;
        if (Math.abs(nextWidth - mainWidth) < 2) return;
        mainWidth = nextWidth;
        debounced();
      });
      observer.observe(main);
    }
  }
  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", debounced);
    observer?.disconnect();
  };
}
