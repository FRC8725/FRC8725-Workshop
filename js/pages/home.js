// js/pages/home.js — floor-plan overview + global search

import { $, el, escapeHtml, icon, isLowStock, isOutOfStock, debounce, inventoryCount, inUseToolCount, formatLocation } from "../utils/utils.js";
import { compareNames, toMillis } from "../utils/item-logic.js";
import { getItems, getFloorPlans, getFloorPlanData, getAllAreas, getStructures, getSummaryStatsConfig, adjustItemQuantity } from "../services/data-service.js";
import { buildLocationIndex, filterItems } from "../utils/search.js";
import {
  computeAreaStats, renderHotspots, setSearchHighlight, clearSearchHighlight,
} from "../ui/map-renderer.js";
import { initLabels } from "../ui/labels.js";
import { renderItems } from "../ui/item-view.js";
import { isCalibrateMode, enableCalibrate } from "../ui/map-calibrate.js";
import { notify } from "../ui/notifications.js";
import { openItemForm } from "../ui/item-form.js";
import { firestoreErrorMessage } from "../services/auth-service.js";

const PLAN_KEY = "workshop-floor-plan-id";

let state = {
  items: [],
  areas: [],
  structures: [],
  index: null,
  filter: "all", // all | tool | material | low
  query: "",
  summaryStats: [],
};

const hotspotHost = () => document.getElementById("map-hotspots");

let navigate = null;

export async function mountPage({ routeTo }) {
  navigate = routeTo;
  state = {
    items: [], areas: [], structures: [], index: null,
    plans: [], planId: null,
    areaPlanIds: new Map(),
    filter: "all", query: "", summaryStats: [],
    summaryFilter: null,
    sortField: "name", sortDir: "asc",
  };

  wireSearch();
  wireFilters();
  wireSortControls();
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
    const [plans, allAreas, structures, summaryStats] = await Promise.all([
      getFloorPlans(), getAllAreas(), getStructures(), getSummaryStatsConfig(), initLabels(),
    ]);
    state.plans = plans;
    state.structures = structures;
    state.summaryStats = summaryStats;
    const planData = await Promise.all(plans.map((plan) => getFloorPlanData(plan)));
    state.areaPlanIds = new Map();
    plans.forEach((plan, index) => {
      for (const area of planData[index].areas || []) state.areaPlanIds.set(area.id, plan.id);
    });
    // 位置索引用「所有平面圖區域的聯集」，跨平面圖的品項名稱也能正確顯示。
    state.index = buildLocationIndex(allAreas, state.structures);

    let saved = "";
    try { saved = localStorage.getItem(PLAN_KEY) || ""; } catch { /* ignore */ }
    state.planId = plans.some((plan) => plan.id === saved) ? saved : plans[0]?.id;

    const img = document.getElementById("workshop-map-image");
    if (img) {
      img.addEventListener("load", fitLayout);
      img.addEventListener("error", () => {
        mapPanel.innerHTML = `<div class="banner banner-danger">平面圖載入失敗：${escapeHtml(img.src)}</div>`;
      });
    }
    renderPlanSwitcher();
    await applyPlan(state.planId, { skipRefresh: true });
    await refreshData();
  } catch (err) {
    console.error(err);
    if (mapPanel) mapPanel.innerHTML =
      `<div class="banner banner-danger">設定載入失敗：${escapeHtml(err.message)}。請確認以 HTTP 伺服器（如 Live Server）開啟，而非直接用 file:// 開啟。</div>`;
  }
}

function currentPlan() {
  return state.plans.find((plan) => plan.id === state.planId) || state.plans[0] || null;
}

/** 切換平面圖：更新標題、影像與可點擊區域。 */
async function applyPlan(planId, { skipRefresh = false } = {}) {
  const plan = state.plans.find((p) => p.id === planId) || state.plans[0];
  if (!plan) return;
  state.planId = plan.id;
  try { localStorage.setItem(PLAN_KEY, plan.id); } catch { /* ignore */ }

  const titleEl = document.querySelector(".map-panel .card-title");
  if (titleEl) titleEl.textContent = plan.name || "培訓室平面圖";

  const data = await getFloorPlanData(plan);
  state.areas = data.areas || [];
  const img = document.getElementById("workshop-map-image");
  if (img && data.image) { img.alt = plan.name || "培訓室平面圖"; img.src = data.image; }

  document.querySelectorAll(".plan-switcher .plan-tab").forEach((tab) => {
    const active = tab.dataset.planId === plan.id;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });

  renderMap();
  if (!skipRefresh) fitLayout();
}

function renderPlanSwitcher() {
  const panel = document.querySelector(".map-panel");
  if (!panel) return;
  let host = panel.querySelector(".plan-switcher");
  if (state.plans.length <= 1) { host?.remove(); return; }
  if (!host) {
    host = el("div", { class: "plan-switcher", role: "tablist", "aria-label": "選擇平面圖" });
    const title = panel.querySelector(".card-title");
    title.after(host);
  }
  host.replaceChildren();
  for (const plan of state.plans) {
    const tab = el("button", {
      type: "button",
      role: "tab",
      class: "plan-tab" + (plan.id === state.planId ? " is-active" : ""),
      "data-plan-id": plan.id,
      "aria-selected": plan.id === state.planId ? "true" : "false",
      tabindex: plan.id === state.planId ? "0" : "-1",
      title: plan.name || plan.id,
    }, plan.name || plan.id);
    tab.addEventListener("click", () => { if (plan.id !== state.planId) applyPlan(plan.id); });
    host.appendChild(tab);
  }
  if (!host.dataset.keyboardWired) {
    host.dataset.keyboardWired = "1";
    host.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tabs = [...host.querySelectorAll(".plan-tab")];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0 || tabs.length < 2) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(current + direction + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
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
    onOpen: (area) => navigate("storage", { id: area.id }),
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
    const active = state.summaryFilter === config.id;
    const card = el("button", {
      type: "button",
      class: "stat stat-configured stat-button" + (active ? " is-active" : ""),
      style: `--stat-color:${color}`,
      "aria-pressed": active ? "true" : "false",
      title: active ? "再點一次取消此摘要篩選" : `顯示「${config.label || config.id}」的所有品項`,
    },
      el("div", { class: "stat-val" }, String(value)),
      el("div", { class: "stat-label" }, config.label || config.id || "未命名"),
    );
    card.addEventListener("click", () => toggleSummaryFilter(config));
    grid.appendChild(card);
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

/** 摘要「列出品項」用的判斷（與數值不同：一筆品項算一筆結果）。 */
function matchesSummaryForList(item, filter) {
  // 「使用中工具」以 quantity < totalQuantity 為準，而不是可能過期的 status。
  if (filter.category === "tool" && filter.status === "in-use") {
    return item.category === "tool" && inUseToolCount(item) > 0;
  }
  return matchesSummaryFilter(item, filter);
}

function toggleSummaryFilter(config) {
  if (state.summaryFilter === config.id) {
    state.summaryFilter = null;
  } else {
    state.summaryFilter = config.id;
    // 與「全部／工具／材料／低存量」按鈕同步：以摘要條件為準，
    // 並把類型按鈕切到對應（或「全部」）避免互相矛盾。
    const filter = config.filter || {};
    let mapped = "all";
    if (filter.stock) mapped = "low";
    else if (filter.category === "tool") mapped = "tool";
    else if (filter.category === "material") mapped = "material";
    state.filter = mapped;
    document.querySelectorAll(".filter-btn").forEach((button) =>
      button.classList.toggle("active", button.dataset.filter === mapped));
  }
  renderSummary();
  renderResults();
  fitLayout();
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
      // 手動切換類型篩選時取消摘要篩選，避免兩者互相矛盾。
      if (state.summaryFilter) {
        state.summaryFilter = null;
        renderSummary();
      }
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderResults();
    });
  });
}

function wireSortControls() {
  const fieldSelect = document.getElementById("result-sort");
  const dirButton = document.getElementById("result-sort-dir");
  const renderDirection = () => {
    if (!dirButton) return;
    const ascending = state.sortDir === "asc";
    dirButton.innerHTML = icon(ascending ? "sort-asc" : "sort-desc", { size: "18px" });
    dirButton.setAttribute("aria-label", ascending ? "目前為升冪，切換為降冪" : "目前為降冪，切換為升冪");
    dirButton.title = ascending ? "升冪" : "降冪";
  };
  renderDirection();
  fieldSelect?.addEventListener("change", () => {
    state.sortField = fieldSelect.value;
    renderResults();
  });
  dirButton?.addEventListener("click", () => {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    dirButton.dataset.dir = state.sortDir;
    renderDirection();
    renderResults();
  });
}

function sortResults(results) {
  const direction = state.sortDir === "asc" ? 1 : -1;
  const field = state.sortField;
  const locationOf = (item) =>
    `${state.index?.storageName(item.storageId) || ""} ${state.index?.sectionName(item.storageId, item.sectionId) || ""}`;
  return [...results].sort((a, b) => {
    let compared;
    switch (field) {
      case "type":
        compared = compareNames(a.category, b.category) || compareNames(a.name, b.name);
        break;
      case "location":
        compared = compareNames(locationOf(a), locationOf(b)) || compareNames(a.name, b.name);
        break;
      case "quantity":
        compared = (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
        break;
      case "updated":
        compared = toMillis(a.updatedAt) - toMillis(b.updatedAt);
        break;
      default:
        compared = compareNames(a.name, b.name);
    }
    return compared * direction;
  });
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
  const summaryConfig = state.summaryFilter
    ? state.summaryStats.find((entry) => entry.id === state.summaryFilter)
    : null;
  if (summaryConfig) {
    // 摘要條件為準；文字搜尋仍共同作用（filterItems 已先套用）。
    results = results.filter((item) => matchesSummaryForList(item, summaryConfig.filter || {}));
  } else {
    results = applyFilter(results);
  }
  return sortResults(results);
}

function renderActiveSummaryChip() {
  const host = document.getElementById("active-summary-filter");
  if (!host) return;
  host.replaceChildren();
  if (!state.summaryFilter) return;
  const config = state.summaryStats.find((entry) => entry.id === state.summaryFilter);
  if (!config) return;
  const chip = el("div", { class: "active-summary-chip" },
    el("span", {}, `摘要篩選：${config.label || config.id}`),
    el("button", {
      type: "button", class: "icon-btn", "aria-label": "清除摘要篩選",
      onclick: () => toggleSummaryFilter(config),
    }, "×"),
  );
  host.appendChild(chip);
}

function renderResults() {
  const host = document.getElementById("result-list");
  const countEl = document.getElementById("result-count");
  if (!host) return;

  renderActiveSummaryChip();
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
  renderItems(results, host, { page: "search", index: state.index });
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
        await adjustItemQuantity(item.id, delta, item);
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

  // Hover / focus → highlight the owning plan tab when the item is on another
  // plan; otherwise highlight its cabinet on the currently visible map.
  const setLocationHighlight = (storageId, active) => {
    const planId = state.areaPlanIds.get(storageId);
    if (planId && planId !== state.planId) {
      const tab = document.querySelector(`.plan-tab[data-plan-id="${CSS.escape(planId)}"]`);
      tab?.classList.toggle("is-search-highlighted", active);
      return;
    }
    if (active) setSearchHighlight(storageId);
    else clearSearchHighlight(storageId);
  };
  const onEnter = (e) => {
    const wrap = e.target.closest("[data-storage-id]");
    if (!wrap || !host.contains(wrap)) return;
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return; // moving within same item
    if (wrap.dataset.storageId) setLocationHighlight(wrap.dataset.storageId, true);
  };
  const onLeave = (e) => {
    const wrap = e.target.closest("[data-storage-id]");
    if (!wrap || !host.contains(wrap)) return;
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return; // still within same item
    if (wrap.dataset.storageId) setLocationHighlight(wrap.dataset.storageId, false);
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
    wrapper.style.height = "";
    setMaxH(mapEl, 0);
    setMaxH(img, 0);
    return;
  }
  const rect = wrapper.getBoundingClientRect();
  const card = wrapper.closest(".map-panel");
  const legend = card ? card.querySelector(".map-legend") : null;
  const below = (legend ? legend.offsetHeight : 0) + 54; // legend + card/wrapper padding + breathing
  const avail = Math.max(240, window.innerHeight - rect.top - below);
  wrapper.style.height = `${Math.round(avail)}px`;
  // The image must fit inside the wrapper's content box, not underneath its
  // padding/border; otherwise a small vertical scrollbar appears.
  const wrapperStyle = getComputedStyle(wrapper);
  const verticalChrome = parseFloat(wrapperStyle.paddingTop) + parseFloat(wrapperStyle.paddingBottom)
    + parseFloat(wrapperStyle.borderTopWidth) + parseFloat(wrapperStyle.borderBottomWidth);
  const innerHeight = Math.max(200, avail - verticalChrome);
  setMaxH(mapEl, innerHeight);
  setMaxH(img, innerHeight);
}

function fitResults() {
  const list = document.getElementById("result-list");
  if (!list) return;
  if (window.innerWidth <= 768) {          // mobile: use a portion of the viewport
    setMaxH(list, Math.round(window.innerHeight * 0.6));
    return;
  }
  // Desktop height is controlled by the equal-height sidebar/map columns.
  setMaxH(list, 0);
}

function fitHomeColumns() {
  const sidebar = document.querySelector(".home-layout > .sidebar");
  const mapPanel = document.querySelector(".home-layout > .map-panel");
  if (!sidebar || !mapPanel) return;
  if (window.innerWidth <= 768) {
    sidebar.style.height = "";
    return;
  }
  sidebar.style.height = `${Math.round(mapPanel.getBoundingClientRect().height)}px`;
}

function fitLayout() {
  fitMap();
  fitHomeColumns();
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
