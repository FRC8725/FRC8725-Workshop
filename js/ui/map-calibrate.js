// js/map-calibrate.js
//
// 平面圖校正工具。在 #/home?calibrate=1 開啟：
//   1. 顯示目前所有可點擊區域的外框與名稱
//   2. 可在平面圖上「拖曳」畫出一個矩形，即時算出百分比座標
//   3. 產生可直接貼進對應 map JSON 的 { x, y, width, height } 片段並複製到剪貼簿
//
// 這讓你換上新的平面圖後，能快速量出每個櫃子的座標，不需自己換算百分比。

import { el } from "../utils/utils.js";

/** 是否處於校正模式（URL ?calibrate=1）。 */
export function isCalibrateMode() {
  const query = location.hash.split("?")[1] || "";
  return new URLSearchParams(query).get("calibrate") === "1";
}

/**
 * 啟用校正工具。
 * @param {HTMLElement} mapEl  - .workshop-map 容器
 * @param {HTMLElement} hotspotHost - #map-hotspots
 * @param {Array} areas
 */
export function enableCalibrate(mapEl, hotspotHost, areas) {
  mapEl.classList.add("calibrating");

  // 為每個現有區域加上名稱標籤，方便對照
  for (const area of areas) {
    const label = el("span", { class: "calib-label" }, area.name);
    label.style.left = `${area.x}%`;
    label.style.top = `${area.y}%`;
    hotspotHost.appendChild(label);
  }

  // 拖曳用的暫時矩形
  const rect = el("div", { class: "calib-rect" });
  rect.style.display = "none";
  mapEl.appendChild(rect);

  // 讀數面板
  const readout = el("div", { class: "calib-readout" },
    el("div", { class: "calib-hint" }, "校正模式：在平面圖上拖曳畫出一個櫃子範圍"),
    el("pre", { class: "calib-json", id: "calib-json" }, "{ }"),
    el("button", { class: "btn btn-sm btn-primary", id: "calib-copy", type: "button" }, "複製 JSON"),
  );
  document.body.appendChild(readout);
  const jsonEl = readout.querySelector("#calib-json");
  const copyBtn = readout.querySelector("#calib-copy");

  let start = null;
  let last = null;

  const pct = (e) => {
    const b = mapEl.getBoundingClientRect();
    return {
      x: ((e.clientX - b.left) / b.width) * 100,
      y: ((e.clientY - b.top) / b.height) * 100,
    };
  };
  const round = (n) => Math.round(n * 100) / 100;

  mapEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    start = pct(e);
    rect.style.display = "block";
    update(start);
  });
  mapEl.addEventListener("mousemove", (e) => {
    if (!start) return;
    update(pct(e));
  });
  window.addEventListener("mouseup", () => { start = null; });

  function update(cur) {
    last = cur;
    const x = Math.min(start.x, cur.x);
    const y = Math.min(start.y, cur.y);
    const w = Math.abs(cur.x - start.x);
    const h = Math.abs(cur.y - start.y);
    rect.style.left = `${x}%`;
    rect.style.top = `${y}%`;
    rect.style.width = `${w}%`;
    rect.style.height = `${h}%`;
    jsonEl.textContent = JSON.stringify(
      { x: round(x), y: round(y), width: round(w), height: round(h) }, null, 2
    );
  }

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(jsonEl.textContent);
      copyBtn.textContent = "已複製！";
      setTimeout(() => (copyBtn.textContent = "複製 JSON"), 1500);
    } catch {
      copyBtn.textContent = "無法複製（請手動選取）";
    }
  });
}
