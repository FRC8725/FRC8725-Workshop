// js/map-renderer.js — renders the interactive floor-plan hotspots

import { el, isLowStock, inventoryCount, availableToolCount, inUseToolCount } from "../utils/utils.js";
import { storageTypeLabel } from "./labels.js";

/**
 * Compute per-area summary from item list.
 * @returns Map<storageId, {total, toolsAvailable, toolsInUse, lowStock}>
 */
export function computeAreaStats(items) {
  const stats = new Map();
  for (const it of items) {
    const id = it.storageId;
    if (!stats.has(id)) stats.set(id, { total: 0, toolsAvailable: 0, toolsInUse: 0, lowStock: 0 });
    const s = stats.get(id);
    s.total += inventoryCount(it);
    if (it.category === "tool") {
      s.toolsAvailable += availableToolCount(it);
      s.toolsInUse += inUseToolCount(it);
    }
    if (isLowStock(it) || (it.category === "material" && Number(it.quantity) === 0)) s.lowStock += 1;
  }
  return stats;
}

/**
 * Render hotspots into the map.
 * @param {object} cfg
 * @param {HTMLElement} cfg.host - #map-hotspots
 * @param {Array} cfg.areas
 * @param {Map} cfg.stats
 * @param {(area)=>void} cfg.onOpen
 */
// Registry so search results can highlight the matching hotspot by storageId.
const registry = new Map(); // storageId -> { btn, area, stats }

export function renderHotspots({ host, areas, stats, onOpen }) {
  host.innerHTML = "";
  registry.clear();
  const tooltip = ensureTooltip();

  for (const area of areas) {
    const s = stats.get(area.id) || { total: 0, toolsAvailable: 0, toolsInUse: 0, lowStock: 0 };
    const btn = el("button", {
      class: "map-hotspot",
      "data-area-id": area.id,
      "data-storage-id": area.id,
      "aria-label": `${area.name}，共 ${s.total} 項物品`,
      title: "",
    });
    registry.set(area.id, { btn, area, stats: s });
    btn.style.left = `${area.x}%`;
    btn.style.top = `${area.y}%`;
    btn.style.width = `${area.width}%`;
    btn.style.height = `${area.height}%`;
    if (area.rotation) btn.style.transform = `rotate(${area.rotation}deg)`;

    const open = () => onOpen(area);
    btn.addEventListener("click", open);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    btn.addEventListener("mouseenter", (e) => showTooltip(tooltip, area, s, e));
    btn.addEventListener("mousemove", (e) => positionTooltip(tooltip, e));
    btn.addEventListener("focus", (e) => {
      const rect = btn.getBoundingClientRect();
      showTooltip(tooltip, area, s, { clientX: rect.left + rect.width / 2, clientY: rect.top });
    });
    btn.addEventListener("mouseleave", () => hideTooltip(tooltip));
    btn.addEventListener("blur", () => hideTooltip(tooltip));

    host.appendChild(btn);
  }
}

/**
 * Highlight a hotspot from a search-result hover/focus, showing its tooltip.
 * Uses a dedicated class so it never fights the hotspot's own :hover state.
 */
export function setSearchHighlight(storageId) {
  const entry = registry.get(storageId);
  if (!entry) return;
  entry.btn.classList.add("is-search-highlighted");
  const rect = entry.btn.getBoundingClientRect();
  showTooltip(ensureTooltip(), entry.area, entry.stats, {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top,
  });
}

/** Remove a search-driven highlight. Keeps tooltip if the cursor is still on the hotspot. */
export function clearSearchHighlight(storageId) {
  const entry = registry.get(storageId);
  if (!entry) return;
  entry.btn.classList.remove("is-search-highlighted");
  if (!entry.btn.matches(":hover") && tooltipEl) hideTooltip(tooltipEl);
}

/* ---------------- Tooltip ---------------- */

let tooltipEl = null;
function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = el("div", { class: "map-tooltip", role: "tooltip" });
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function showTooltip(tt, area, s, e) {
  tt.innerHTML = `
    <div class="tt-name"></div>
    <div class="tt-row"><span>類型</span><span></span></div>
    <div class="tt-row"><span>物品總數</span><span></span></div>
    <div class="tt-row"><span>可用工具</span><span></span></div>
    <div class="tt-row"><span>使用中工具</span><span></span></div>
    <div class="tt-row"><span>低存量材料</span><span></span></div>
  `;
  tt.querySelector(".tt-name").textContent = area.name;
  const vals = tt.querySelectorAll(".tt-row span:last-child");
  vals[0].textContent = storageTypeLabel(area.type);
  vals[1].textContent = s.total;
  vals[2].textContent = s.toolsAvailable;
  vals[3].textContent = s.toolsInUse;
  vals[4].textContent = s.lowStock;
  tt.classList.add("show");
  positionTooltip(tt, e);
}

function positionTooltip(tt, e) {
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const rect = tt.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
  tt.style.left = `${Math.max(6, x)}px`;
  tt.style.top = `${Math.max(6, y)}px`;
}

function hideTooltip(tt) {
  tt.classList.remove("show");
}
