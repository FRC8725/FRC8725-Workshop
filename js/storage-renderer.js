// js/storage-renderer.js — renders a cabinet's physical structure + items
//
// 物品卡片/列表的實際渲染共用 js/item-view.js；此檔只負責產生櫃子的
// 物理結構 Grid，並把每個 section 內的物品交給共用 renderer。

import { el } from "./utils.js";
import { renderItem } from "./item-view.js";

const SECTION_TYPE_LABELS = {
  drawer: "抽屜", shelf: "層板", hook: "掛勾", bin: "格", area: "區域",
};

/**
 * Render the full structure grid.
 * @param {object} cfg
 * @param {HTMLElement} cfg.host
 * @param {object} cfg.structure
 * @param {Array} cfg.items - items belonging to this storage (already filtered)
 * @param {"card"|"list"} cfg.viewMode
 * @param {object} cfg.ctx - render context passed to item-view ({ page:"storage", index })
 * @param {(sectionId)=>void} cfg.onAdd
 */
export function renderStructure({ host, structure, items, viewMode, ctx, onAdd }) {
  host.innerHTML = "";
  const grid = el("div", { class: "structure-grid" });
  grid.style.gridTemplateColumns = `repeat(${structure.columns}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${structure.rows}, minmax(110px, auto))`;

  const bySection = new Map();
  for (const it of items) {
    const key = it.sectionId || "__none__";
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(it);
  }

  for (const sec of structure.sections || []) {
    const cell = el("div", { class: "section-cell", "data-section-id": sec.id });
    cell.style.gridColumn = `${sec.column} / span ${sec.columnSpan || 1}`;
    cell.style.gridRow = `${sec.row} / span ${sec.rowSpan || 1}`;

    const secItems = bySection.get(sec.id) || [];
    const head = el("div", { class: "section-head" },
      el("span", { class: "section-name" }, sec.name),
      el("span", { class: "badge badge-muted badge-plain section-type" },
        `${SECTION_TYPE_LABELS[sec.type] || sec.type} · ${secItems.length}`)
    );
    cell.appendChild(head);

    const list = el("div", { class: "section-items items-container" });
    list.classList.toggle("view-card", viewMode !== "list");
    list.classList.toggle("view-list", viewMode === "list");
    if (secItems.length === 0) {
      list.appendChild(el("div", { class: "section-empty" }, "（此位置尚無物品）"));
    } else {
      for (const it of secItems) list.appendChild(renderItem(it, viewMode, ctx));
    }
    cell.appendChild(list);

    const addBtn = el("button", {
      class: "btn btn-ghost btn-sm",
      style: "margin-top:10px; align-self:flex-start;",
      onclick: () => onAdd(sec.id),
    }, "＋ 新增至此");
    cell.appendChild(addBtn);

    grid.appendChild(cell);
  }
  host.appendChild(grid);
}
