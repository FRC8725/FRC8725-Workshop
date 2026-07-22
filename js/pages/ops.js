// js/pages/ops.js — 作業頁：使用（盒子）與備料（備料單）兩個分頁。
//
// 所有庫存變動（盒子取用／歸還、備料取料）都由 ops-service 以原子操作完成，
// 這裡只負責 UI、驗證輸入與重新整理畫面。

import { el, escapeHtml, formatDateTime, formatLocation, icon } from "../utils/utils.js";
import { compareNames, sortByName, isToolTakable, formatMaterialQuantity } from "../utils/item-logic.js";
import { initLabels, categoryTag, makeBadge } from "../ui/labels.js";
import { getItems, getWorkshopMap, getStructures } from "../services/data-service.js";
import { buildLocationIndex } from "../utils/search.js";
import {
  getUsageBoxes, createUsageBox, boxTransferItem, boxTakeItems, deleteUsageBox,
  getPrepOrders, createPrepOrder, updatePrepOrder, executePrepOrder, deletePrepOrder,
} from "../services/ops-service.js";
import { getAuthorizedUserOptions } from "../services/user-service.js";
import { openModal, closeModal, confirmModal } from "../ui/modal.js";
import { createDataMatrixScanner } from "../ui/datamatrix.js";
import { notify } from "../ui/notifications.js";
import { firestoreErrorMessage } from "../services/auth-service.js";

const DOMAIN_CODES = new Set([
  "invalid-quantity", "invalid-delta", "insufficient", "over-total", "over-held",
  "special-status", "box-closed", "box-not-empty", "order-not-draft", "not-found",
]);

function errorText(err) {
  if (DOMAIN_CODES.has(err?.code)) return err.message;
  if (err?.code === "permission-denied") {
    return "沒有資料存取權限。若剛更新此系統，請管理員到 Firebase Console 發布最新的 firestore.rules"
      + "（需包含 usageBoxes、prepOrders、activityLogs 的規則）。";
  }
  return firestoreErrorMessage(err);
}

const BOX_STATUS = {
  active: { label: "使用中", color: "#7dff95" },
  closed: { label: "已結束", color: "#7d7d7d" },
};
const ORDER_STATUS = {
  draft: { label: "草稿", color: "#87d1ff" },
  prepared: { label: "已備料", color: "#7dff95" },
};

let state = null;

export async function mountPage({ session, params }) {
  state = {
    session,
    tab: params.get("tab") === "prep" ? "prep" : "boxes",
    boxes: [],
    orders: [],
    items: [],
    userOptions: [],
    boxQuery: "",
    prepQuery: "",
    loading: true,
    loadError: null,
  };

  wireTabs();
  wireToolbars();
  wireBoxDelegation();
  wirePrepDelegation();
  switchTab(state.tab, { replaceUrl: false });

  // 個別載入：任一來源失敗（例如 rules 尚未更新）不會拖垮整頁。
  const [boxes, orders, items, userOptions, locationConfig] = await Promise.allSettled([
    getUsageBoxes(), getPrepOrders(), getItems(), getAuthorizedUserOptions(),
    Promise.all([getWorkshopMap(), getStructures()]), initLabels(),
  ]);
  state.loading = false;
  if (boxes.status === "fulfilled") state.boxes = boxes.value;
  if (orders.status === "fulfilled") state.orders = orders.value;
  if (items.status === "fulfilled") state.items = items.value;
  state.userOptions = sortByName(
    userOptions.status === "fulfilled" ? userOptions.value : [], (u) => u.displayName);
  if (locationConfig.status === "fulfilled") {
    const [map, structures] = locationConfig.value;
    state.locationIndex = buildLocationIndex(map.areas || [], structures);
  }
  const failure = [boxes, orders, items].find((entry) => entry.status === "rejected");
  if (failure) {
    console.error(failure.reason);
    state.loadError = errorText(failure.reason);
  }
  renderBoxes();
  renderPrep();
}

async function refreshOps({ boxes = true, orders = true, items = true } = {}) {
  try {
    const [nextBoxes, nextOrders, nextItems] = await Promise.all([
      boxes ? getUsageBoxes() : state.boxes,
      orders ? getPrepOrders() : state.orders,
      items ? getItems() : state.items,
    ]);
    state.boxes = nextBoxes;
    state.orders = nextOrders;
    state.items = nextItems;
  } catch (err) {
    console.error(err);
    notify.danger("資料更新失敗：" + errorText(err));
  }
  renderBoxes();
  renderPrep();
}

/* ================= tabs ================= */

function wireTabs() {
  document.querySelectorAll(".ops-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });
}

function switchTab(tab, { replaceUrl = true } = {}) {
  state.tab = tab === "prep" ? "prep" : "boxes";
  document.querySelectorAll(".ops-tab").forEach((button) => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.getElementById("panel-boxes").hidden = state.tab !== "boxes";
  document.getElementById("panel-prep").hidden = state.tab !== "prep";
  if (replaceUrl) history.replaceState(null, "", `#/ops?tab=${state.tab}`);
}

function wireToolbars() {
  document.getElementById("box-search")?.addEventListener("input", (event) => {
    state.boxQuery = event.target.value;
    renderBoxes();
  });
  document.getElementById("prep-search")?.addEventListener("input", (event) => {
    state.prepQuery = event.target.value;
    renderPrep();
  });
  document.getElementById("add-box-btn")?.addEventListener("click", () => openBoxForm());
  document.getElementById("add-prep-btn")?.addEventListener("click", () => openPrepForm());
}

function stateBlock(title, message) {
  return el("div", { class: "state-block" },
    el("div", { class: "st-title" }, title),
    el("div", { class: "st-msg" }, message || ""),
  );
}

/* ================= 使用分頁：盒子 ================= */

function renderBoxes() {
  const host = document.getElementById("box-list");
  if (!host) return;
  host.replaceChildren();
  if (state.loading) { host.appendChild(el("div", { class: "state-block" }, el("div", { class: "spinner" }), "載入盒子…")); return; }
  if (state.loadError) { host.appendChild(stateBlock("載入失敗", state.loadError)); return; }

  const query = state.boxQuery.trim().toLowerCase();
  let boxes = sortByName(state.boxes, (box) => box.userName);
  if (query) {
    boxes = boxes.filter((box) =>
      `${box.userName}`.toLowerCase().includes(query));
  }
  if (!boxes.length) {
    host.appendChild(stateBlock(
      query ? "沒有符合的盒子" : "還沒有任何盒子",
      query ? "試試其他關鍵字。" : "點「＋ 新增盒子」開始記錄。"));
    return;
  }
  for (const box of boxes) host.appendChild(renderBoxCard(box));
}

function renderBoxCard(box) {
  const statusDef = BOX_STATUS[box.status] || BOX_STATUS.active;
  const entries = sortByName(box.items || [], (entry) => entry.name);
  const hasUnreturnedTools = boxHasUnreturnedTools(box);
  const canManage = canManageBox(box);
  const card = el("article", { class: "ops-card usage-box-card", "data-box-id": box.id });
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `打開 ${box.userName || "使用者"}的盒子，共 ${entries.length} 項物品`);

  const head = el("div", { class: "ops-card-head" },
    el("div", { class: "ops-card-title" },
      el("strong", {}, box.userName || "（未指定使用者）"),
      makeBadge(statusDef.label, statusDef.color),
    ),
    el("div", { class: "ops-card-meta" },
      el("span", {}, `建立：${formatDateTime(box.createdAt) || "—"}（${box.createdByName || "—"}）`),
    ),
  );
  card.appendChild(head);

  const list = el("div", { class: "ops-entry-list usage-box-entries" });
  if (!entries.length) {
    list.appendChild(el("div", { class: "section-empty" }, "（盒子目前是空的）"));
  } else {
    for (const entry of entries.slice(0, 3)) {
      list.appendChild(el("div", { class: "ops-entry", "data-entry-item-id": entry.itemId },
        categoryTag(entry.category),
        el("span", { class: "ops-entry-name", title: entry.name }, entry.name),
        el("span", { class: "ops-entry-qty" }, `${entry.quantity}${entry.unit || ""}`),
        itemLocation(entry.itemId),
        box.status === "active"
          ? el("button", { class: "btn btn-ghost btn-sm", type: "button", "data-action": "return-entry" }, "歸還")
          : null,
      ));
    }
    if (entries.length > 3) {
      list.appendChild(el("div", { class: "usage-box-more" }, `另有 ${entries.length - 3} 項`));
    }
  }
  card.appendChild(list);

  const actions = el("div", { class: "ops-card-actions" });
  if (box.status === "active") {
    actions.appendChild(el("button", { class: "btn btn-primary btn-sm", type: "button", "data-action": "take" },
      el("span", { html: icon("plus", { size: "14px" }) }), "取用物品"));
  }
  if (!hasUnreturnedTools && canManage) {
    actions.appendChild(el("button", { class: "btn btn-danger btn-sm", type: "button", "data-action": "delete-box" }, "刪除"));
  }
  card.appendChild(actions);
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    openBoxView(box);
  });
  card.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target === card) {
      event.preventDefault();
      openBoxView(box);
    }
  });
  return card;
}

function canManageBox(box) {
  const session = state?.session;
  if (!session) return false;
  if (session.role === "admin") return true;
  return Boolean(box.createdByUid && box.createdByUid === session.user?.uid);
}

function boxHasUnreturnedTools(box) {
  return (box.items || []).some((entry) =>
    entry.category === "tool" && (Number(entry.quantity) || 0) > 0);
}

function openBoxView(box) {
  const statusDef = BOX_STATUS[box.status] || BOX_STATUS.active;
  const entries = sortByName(box.items || [], (entry) => entry.name);
  const body = el("div", { class: "usage-box-view" });
  body.appendChild(el("div", { class: "usage-box-view-head" },
    el("div", { class: "ops-card-title" },
      el("strong", {}, box.userName || "（未指定使用者）"),
      makeBadge(statusDef.label, statusDef.color)),
    el("div", { class: "ops-card-meta" },
      el("span", {}, `建立：${formatDateTime(box.createdAt) || "—"}（${box.createdByName || "—"}）`),
      el("span", {}, `盒內共有 ${entries.length} 項物品`)),
  ));

  const list = el("div", { class: "ops-entry-list usage-box-view-entries" });
  if (!entries.length) {
    list.appendChild(el("div", { class: "section-empty" }, "（盒子目前是空的）"));
  } else {
    for (const entry of entries) {
      const row = el("div", { class: "ops-entry", "data-entry-item-id": entry.itemId },
        categoryTag(entry.category),
        el("span", { class: "ops-entry-name", title: entry.name }, entry.name),
        el("span", { class: "ops-entry-qty" }, `${entry.quantity}${entry.unit || ""}`),
        itemLocation(entry.itemId));
      if (box.status === "active") {
        row.appendChild(el("button", {
          class: "btn btn-ghost btn-sm", type: "button",
          onclick: () => openReturnModal(box, entry),
        }, "歸還"));
      }
      list.appendChild(row);
    }
  }
  body.appendChild(list);

  const footer = el("div", { class: "usage-box-view-actions" });
  const done = el("button", { class: "btn btn-ghost", type: "button", onclick: () => closeModal() }, "關閉");
  footer.appendChild(done);
  if (box.status === "active") {
    footer.appendChild(el("button", {
      class: "btn btn-primary", type: "button", onclick: () => openTakeModal(box),
    }, el("span", { html: icon("plus", { size: "14px" }) }), "取用物品"));
  }
  if (!boxHasUnreturnedTools(box) && canManageBox(box)) {
    footer.appendChild(el("button", {
      class: "btn btn-danger", type: "button", onclick: () => handleDeleteBox(box),
    }, "刪除"));
  }
  openModal({ title: "盒子內容", body, footer, maxWidth: "760px", className: "usage-box-modal" });
}

function wireBoxDelegation() {
  const host = document.getElementById("box-list");
  if (!host || host.dataset.wired) return;
  host.dataset.wired = "1";
  host.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !host.contains(button)) return;
    const card = event.target.closest("[data-box-id]");
    const box = state.boxes.find((candidate) => candidate.id === card?.dataset.boxId);
    if (!box) return;
    if (button.dataset.action === "take") openTakeModal(box);
    else if (button.dataset.action === "return-entry") {
      const entryRow = event.target.closest("[data-entry-item-id]");
      const entry = (box.items || []).find((candidate) => candidate.itemId === entryRow?.dataset.entryItemId);
      if (entry) openReturnModal(box, entry);
    } else if (button.dataset.action === "delete-box") handleDeleteBox(box);
  });
}

/* ---------- 新增盒子 ---------- */

function openBoxForm() {
  const form = el("form", { class: "item-form", novalidate: "novalidate" });
  const userOptions = state.userOptions
    .map((user) => `<option value="${escapeHtml(user.uid)}">${escapeHtml(user.displayName)}</option>`)
    .join("");
  form.innerHTML = `
    <div class="field">
      <label for="box-user-select">從現有使用者選擇（選填）</label>
      <select id="box-user-select"><option value="">— 自行輸入名字 —</option>${userOptions}</select>
    </div>
    <div class="field">
      <label for="box-user-name">使用者名稱 <span class="req">*</span></label>
      <input id="box-user-name" name="userName" placeholder="使用這個盒子的人" autocomplete="off">
      <div class="error-text" data-for="userName"></div>
    </div>
  `;
  const select = form.querySelector("#box-user-select");
  const nameInput = form.querySelector("#box-user-name");
  select.addEventListener("change", () => {
    const user = state.userOptions.find((candidate) => candidate.uid === select.value);
    if (user) nameInput.value = user.displayName;
  });
  nameInput.addEventListener("input", () => {
    const user = state.userOptions.find((candidate) => candidate.uid === select.value);
    if (user && nameInput.value.trim() !== user.displayName) select.value = "";
  });

  const footer = el("div", { style: "display:flex; gap:10px" });
  const cancel = el("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const save = el("button", { type: "submit", class: "btn btn-primary" }, "建立紀錄");
  footer.append(cancel, save);
  openModal({ title: "新增盒子", body: form, footer, maxWidth: "460px" });
  cancel.addEventListener("click", () => closeModal());
  save.addEventListener("click", (event) => { event.preventDefault(); form.requestSubmit(); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const userName = nameInput.value.trim();
    const errors = {};
    if (!userName) errors.userName = "請輸入使用者名稱";
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    const selected = state.userOptions.find((candidate) => candidate.uid === select.value);
    const userUid = selected && selected.displayName === userName ? selected.uid : null;
    save.disabled = true; cancel.disabled = true; save.textContent = "建立中…";
    try {
      await createUsageBox({ name: userName, userName, userUid });
      notify.success("已建立盒子");
      closeModal();
      await refreshOps({ orders: false, items: false });
    } catch (err) {
      console.error(err);
      notify.danger("建立失敗：" + errorText(err));
      save.disabled = false; cancel.disabled = false; save.textContent = "建立紀錄";
    }
  });
}

/* ---------- 取用物品 ---------- */

function takableItems() {
  return state.items.filter((item) => {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) return false;
    if (item.category === "tool") return isToolTakable(item);
    return item.category === "material";
  });
}

function availabilityText(item) {
  if (item.category === "tool") return `可用 ${Number(item.quantity) || 0}／${Number(item.totalQuantity ?? item.quantity) || 0}`;
  return `庫存 ${formatMaterialQuantity(item)}`;
}

function itemLocation(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return el("span", { class: "ops-entry-location" }, "位置：未分類");
  const storage = state.locationIndex?.storageName(item.storageId) || item.storageId;
  const section = state.locationIndex?.sectionName(item.storageId, item.sectionId) || item.sectionId;
  return el("span", { class: "ops-entry-location", title: formatLocation(storage, section) || "未分類" },
    formatLocation(storage, section) || "未分類");
}

function openTakeModal(box) {
  // 可連續選取多個品項，最後一次確認才寫入。cart: Map<itemId, {item, quantity}>
  const cart = new Map();
  const body = el("div", { class: "take-modal" });
  body.innerHTML = `
    <div class="take-tools">
      <div class="field" style="flex:1; margin:0">
        <label for="take-search">搜尋工具或材料（點一下加入清單）</label>
        <input id="take-search" type="search" placeholder="輸入名稱、標籤…" autocomplete="off">
      </div>
      <button type="button" class="take-scan-btn" id="take-scan-btn" aria-label="開啟相機掃描" title="開啟相機掃描">
        <svg class="scan-ico-on" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <svg class="scan-ico-off" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l22 22"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m4-3h6l2 3h4a2 2 0 0 1 2 2v9"/></svg>
      </button>
    </div>
    <div class="take-scan-region" id="take-scan-region" hidden>
      <video id="take-scan-video" playsinline muted></video>
      <div class="take-scan-status" id="take-scan-status">啟動相機中…</div>
      <div class="take-scan-success" id="take-scan-success" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 2.5 2.5L16 9"/></svg>
        <span id="take-scan-success-text"></span>
      </div>
    </div>
    <div class="take-candidates" id="take-candidates" role="listbox" aria-label="可取用的品項"></div>
    <div class="take-cart-title card-title" style="margin:14px 0 8px">待取用清單（<span id="take-cart-count">0</span>）</div>
    <div class="ops-entry-list" id="take-cart"></div>
  `;
  const searchInput = body.querySelector("#take-search");
  const candidatesHost = body.querySelector("#take-candidates");
  const cartHost = body.querySelector("#take-cart");
  const cartCount = body.querySelector("#take-cart-count");
  const scanBtn = body.querySelector("#take-scan-btn");
  const scanRegion = body.querySelector("#take-scan-region");
  const scanVideo = body.querySelector("#take-scan-video");
  const scanStatus = body.querySelector("#take-scan-status");
  const scanSuccess = body.querySelector("#take-scan-success");
  const scanSuccessText = body.querySelector("#take-scan-success-text");

  function availFor(item) { return Number(item.quantity) || 0; }

  function addToCart(item) {
    const existing = cart.get(item.id);
    const nextQty = (existing?.quantity || 0) + 1;
    if (nextQty > availFor(item)) { notify.warning(`「${item.name}」可用數量只剩 ${availFor(item)}`); return; }
    cart.set(item.id, { item, quantity: nextQty });
    renderCart();
    renderCandidates();
  }

  function renderCandidates() {
    const query = searchInput.value.trim().toLowerCase();
    let candidates = sortByName(takableItems(), (item) => item.name);
    if (query) {
      candidates = candidates.filter((item) =>
        `${item.name} ${(item.tags || []).join(" ")} ${item.description || ""}`.toLowerCase().includes(query));
    }
    candidatesHost.replaceChildren();
    if (!candidates.length) {
      candidatesHost.appendChild(el("div", { class: "section-empty" }, "沒有可取用的品項。"));
      return;
    }
    for (const item of candidates.slice(0, 40)) {
      const inCart = cart.get(item.id);
      const row = el("button", {
        type: "button",
        class: "take-candidate" + (inCart ? " is-selected" : ""),
        role: "option",
      },
        categoryTag(item.category),
        el("span", { class: "take-candidate-name" }, item.name),
        itemLocation(item.id),
        el("span", { class: "take-candidate-avail" }, availabilityText(item)),
        inCart ? el("span", { class: "take-candidate-incart" }, `已加 ${inCart.quantity}`) : null,
      );
      row.addEventListener("click", () => addToCart(item));
      candidatesHost.appendChild(row);
    }
  }

  function renderCart() {
    cartCount.textContent = String(cart.size);
    cartHost.replaceChildren();
    if (!cart.size) {
      cartHost.appendChild(el("div", { class: "section-empty" }, "（尚未選擇，點上方品項加入）"));
      return;
    }
    for (const { item, quantity } of cart.values()) {
      const max = availFor(item);
      const qtyInput = el("input", {
        type: "number", min: "1", max: String(max), step: "1", value: String(quantity),
        class: "take-cart-qty", "aria-label": `${item.name} 數量`,
      });
      qtyInput.addEventListener("input", () => {
        let value = Math.floor(Number(qtyInput.value) || 0);
        if (value < 1) value = 1;
        if (value > max) { value = max; qtyInput.value = String(max); notify.warning(`「${item.name}」最多 ${max}`); }
        cart.set(item.id, { item, quantity: value });
      });
      cartHost.appendChild(el("div", { class: "ops-entry" },
        categoryTag(item.category),
        el("span", { class: "ops-entry-name", title: item.name }, item.name),
        qtyInput,
        el("span", { class: "take-candidate-avail" }, `／${max}`),
        el("button", {
          class: "icon-btn danger", type: "button", "aria-label": `移除 ${item.name}`,
          onclick: () => { cart.delete(item.id); renderCart(); renderCandidates(); },
        }, "×"),
      ));
    }
  }

  searchInput.addEventListener("input", () => {
    // 一開始輸入搜尋內容就切回手動模式，並立即釋放相機。
    if (scanner || starting) stopScan();
    renderCandidates();
  });
  renderCandidates();
  renderCart();

  /* ---------- 相機掃描 Data Matrix ---------- */
  let scanner = null;
  let starting = false;
  let scanGeneration = 0;
  let successTimer = null;
  let successStatusTimer = null;
  const lastScan = { text: null, time: 0 };

  function setScanStatus(text, kind = "") {
    if (kind !== "ok" && successStatusTimer) {
      clearTimeout(successStatusTimer);
      successStatusTimer = null;
    }
    scanStatus.textContent = text;
    scanStatus.className = "take-scan-status" + (kind ? ` is-${kind}` : "");
  }

  function handleScan(text) {
    const now = Date.now();
    const id = String(text || "").trim();
    // 同一條碼連續出現在畫面只算一次；持續可見時滑動視窗，離開畫面 2.5 秒後才能再加。
    if (id && id === lastScan.text && now - lastScan.time < 2500) { lastScan.time = now; return; }
    lastScan.text = id; lastScan.time = now;
    if (!id) { setScanStatus("條碼內容為空，無法辨識", "warn"); return; }

    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) { setScanStatus(`找不到對應物品（ID：${id}）`, "warn"); notify.warning(`找不到對應物品（ID：${id}）`); return; }
    if (item.category !== "tool") { setScanStatus(`「${item.name}」不是工具，無法取用`, "warn"); notify.warning(`「${item.name}」不是工具，無法取用`); return; }
    if (!isToolTakable(item)) { setScanStatus(`「${item.name}」為特殊狀態，無法取用`, "warn"); notify.warning(`「${item.name}」為特殊狀態，無法取用`); return; }
    const avail = availFor(item);
    const inCart = cart.get(item.id)?.quantity || 0;
    if (avail <= 0) { setScanStatus(`「${item.name}」目前沒有可用數量`, "warn"); notify.warning(`「${item.name}」目前沒有可用數量`); return; }
    if (inCart + 1 > avail) { setScanStatus(`「${item.name}」已達可用上限（${avail}）`, "warn"); notify.warning(`「${item.name}」已達可用上限（${avail}）`); return; }

    addToCart(item);                       // +1，並受可用量限制
    const qty = cart.get(item.id)?.quantity || 1;
    setScanStatus(`已加入：${item.name} ×${qty}`, "ok");
    flashSuccess(`${item.name} ×${qty}`);
  }

  // 掃描成功回饋：綠色勾勾疊層 + 邊框脈衝 +（若支援）震動。
  function flashSuccess(text) {
    scanSuccessText.textContent = text;
    scanRegion.classList.remove("flash");
    scanSuccess.classList.remove("show");
    void scanRegion.offsetWidth;
    scanRegion.classList.add("flash");
    scanSuccess.classList.add("show");
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => scanSuccess.classList.remove("show"), 900);
    if (successStatusTimer) clearTimeout(successStatusTimer);
    successStatusTimer = setTimeout(() => {
      if (scanner) setScanStatus("將工具上的條碼對準框內");
    }, 2000);
  }

  async function startScan() {
    if (scanner || starting) return;
    const generation = ++scanGeneration;
    starting = true;
    scanRegion.hidden = false;
    // 相機開啟時收起手動搜尋結果清單，讓取景畫面有更多空間。
    candidatesHost.hidden = true;
    setScanStatus("啟動相機中…");
    scanBtn.classList.add("is-active");
    scanBtn.setAttribute("aria-label", "關閉相機");
    scanBtn.title = "關閉相機";
    try {
      const nextScanner = await createDataMatrixScanner(scanVideo, handleScan, (err) => {
        console.error(err);
        setScanStatus("相機發生問題，可改用手動搜尋。", "warn");
      });
      // 使用者可能在相機啟動期間開始打字；過期的相機不得重新開啟介面。
      if (generation !== scanGeneration) {
        try { nextScanner.stop(); } catch { /* ignore */ }
        return;
      }
      scanner = nextScanner;
      setScanStatus("將工具上的條碼對準框內");
    } catch (err) {
      if (generation !== scanGeneration) return;
      console.error(err);
      const name = err?.name || "";
      let message = "無法啟動相機，請改用手動搜尋。";
      if (name === "NotAllowedError" || name === "SecurityError") message = "相機權限遭拒，請於瀏覽器允許相機後再試，或改用手動搜尋。";
      else if (name === "NotFoundError" || name === "OverconstrainedError") message = "找不到可用的相機，請改用手動搜尋。";
      else if (err?.message) message = err.message;
      notify.warning(message);
      stopScan();
    } finally {
      if (generation === scanGeneration) starting = false;
    }
  }

  function stopScan() {
    scanGeneration += 1;
    starting = false;
    try { scanner?.stop(); } catch { /* ignore */ }
    scanner = null;
    if (successTimer) clearTimeout(successTimer);
    if (successStatusTimer) clearTimeout(successStatusTimer);
    successTimer = null;
    successStatusTimer = null;
    scanRegion.hidden = true;
    scanRegion.classList.remove("flash");
    scanSuccess.classList.remove("show");
    candidatesHost.hidden = false;   // 還原手動搜尋結果清單
    scanBtn.classList.remove("is-active");
    scanBtn.setAttribute("aria-label", "開啟相機掃描");
    scanBtn.title = "開啟相機掃描";
  }

  scanBtn.addEventListener("click", () => { if (scanner || starting) stopScan(); else startScan(); });

  const footer = el("div", { style: "display:flex; gap:10px" });
  const cancel = el("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const confirm = el("button", { type: "button", class: "btn btn-primary" }, "全部放入盒子");
  footer.append(cancel, confirm);
  // 關閉 Modal（含 Esc／點背景／提交）時務必停止相機並釋放資源。
  const { overlay } = openModal({ title: `取用物品 → ${box.userName || "使用者"}`, body, footer, maxWidth: "560px", onClose: () => stopScan() });
  overlay.querySelector(".modal")?.classList.add("take-items-modal");
  startScan();
  // 避免 modal 的預設輸入框焦點在手機上直接叫出鍵盤；仍可隨時點搜尋欄切回手動模式。
  requestAnimationFrame(() => scanBtn.focus());
  cancel.addEventListener("click", () => closeModal());

  confirm.addEventListener("click", async () => {
    if (!cart.size) { notify.warning("請至少選擇一個品項"); return; }
    const entries = [];
    for (const { item, quantity } of cart.values()) {
      if (!Number.isInteger(quantity) || quantity <= 0) { notify.warning(`「${item.name}」數量必須是正整數`); return; }
      if (quantity > availFor(item)) { notify.warning(`「${item.name}」數量不可超過可用數量（${availFor(item)}）`); return; }
      entries.push({ itemId: item.id, quantity });
    }
    confirm.disabled = true; cancel.disabled = true; confirm.textContent = "處理中…";
    try {
      await boxTakeItems({ boxId: box.id, entries });
      notify.success(`已將 ${entries.length} 項物品交給「${box.userName || "使用者"}」`);
      closeModal();
      await refreshOps({ orders: false });
    } catch (err) {
      console.error(err);
      notify.danger("取用失敗：" + errorText(err));
      confirm.disabled = false; cancel.disabled = false; confirm.textContent = "全部放入盒子";
      await refreshOps({ orders: false });
    }
  });
}

/* ---------- 歸還 ---------- */

function openReturnModal(box, entry) {
  const held = Math.max(0, Number(entry.quantity) || 0);
  const body = el("div", {});
  body.innerHTML = `
    <p style="margin-top:0">由「${escapeHtml(box.userName || "使用者")}」歸還 <strong>${escapeHtml(entry.name)}</strong>（目前持有 ${held}${escapeHtml(entry.unit || "")}）。</p>
    <div class="field">
      <label for="return-qty">歸還數量 <span class="req">*</span></label>
      <input id="return-qty" type="number" min="1" max="${held}" step="1" value="${held}">
    </div>
  `;
  const qtyInput = body.querySelector("#return-qty");
  const footer = el("div", { style: "display:flex; gap:10px" });
  const cancel = el("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const all = el("button", { type: "button", class: "btn btn-ghost" }, "全部歸還");
  const confirm = el("button", { type: "button", class: "btn btn-primary" }, "歸還");
  footer.append(cancel, all, confirm);
  openModal({ title: "歸還物品", body, footer, maxWidth: "420px" });
  cancel.addEventListener("click", () => closeModal());
  all.addEventListener("click", () => { qtyInput.value = String(held); });

  confirm.addEventListener("click", async () => {
    const quantity = Number(qtyInput.value);
    if (!Number.isInteger(quantity) || quantity <= 0) { notify.warning("數量必須是正整數"); return; }
    if (quantity > held) { notify.warning(`歸還數量不可超過持有量（${held}）`); return; }
    confirm.disabled = true; cancel.disabled = true; all.disabled = true; confirm.textContent = "處理中…";
    try {
      await boxTransferItem({ boxId: box.id, itemId: entry.itemId, quantity, action: "return" });
      notify.success(`已歸還「${entry.name}」×${quantity}`);
      closeModal();
      await refreshOps({ orders: false });
    } catch (err) {
      console.error(err);
      notify.danger("歸還失敗：" + errorText(err));
      confirm.disabled = false; cancel.disabled = false; all.disabled = false; confirm.textContent = "歸還";
      await refreshOps({ orders: false });
    }
  });
}

async function handleDeleteBox(box) {
  const confirmed = await confirmModal({
    title: "刪除盒子",
    message: `確定刪除「${escapeHtml(box.userName || "使用者")}」的盒子嗎？`,
    detail: "所有工具必須先歸還；材料不必歸還。歷史紀錄（Log）不會被刪除，此操作無法復原。",
    confirmText: "刪除", danger: true,
  });
  if (!confirmed) return;
  try {
    await deleteUsageBox(box.id);
    notify.success("已刪除盒子");
    await refreshOps({ orders: false, items: false });
  } catch (err) {
    console.error(err);
    notify.danger(errorText(err));
  }
}

/* ================= 備料分頁：備料單 ================= */

function renderPrep() {
  const host = document.getElementById("prep-list");
  if (!host) return;
  host.replaceChildren();
  if (state.loading) { host.appendChild(el("div", { class: "state-block" }, el("div", { class: "spinner" }), "載入備料單…")); return; }
  if (state.loadError) { host.appendChild(stateBlock("載入失敗", state.loadError)); return; }

  const query = state.prepQuery.trim().toLowerCase();
  let orders = sortByName(state.orders, (order) => order.name);
  if (query) orders = orders.filter((order) => order.name.toLowerCase().includes(query));
  if (!orders.length) {
    host.appendChild(stateBlock(
      query ? "沒有符合的備料單" : "還沒有任何備料單",
      query ? "試試其他關鍵字。" : "點「＋ 新增備料單」建立第一張備料單。"));
    return;
  }
  for (const order of orders) host.appendChild(renderPrepCard(order));
}

function renderPrepCard(order) {
  const statusDef = ORDER_STATUS[order.status] || ORDER_STATUS.draft;
  const card = el("article", { class: "ops-card prep-order-card", "data-order-id": order.id });
  card.appendChild(el("div", { class: "ops-card-head" },
    el("div", { class: "ops-card-title" },
      el("strong", {}, order.name),
      makeBadge(statusDef.label, statusDef.color),
    ),
    el("div", { class: "ops-card-meta" },
      el("span", {}, `建立：${formatDateTime(order.createdAt) || "—"}（${order.createdByName || "—"}）`),
      order.status === "prepared" ? el("span", {}, `備料：${formatDateTime(order.preparedAt) || "—"}`) : null,
    ),
  ));

  const list = el("div", { class: "ops-entry-list" });
  const lines = order.lines || [];
  if (!lines.length) {
    list.appendChild(el("div", { class: "section-empty" }, "（此備料單沒有明細）"));
  } else {
    for (const line of lines) {
      list.appendChild(el("div", { class: "ops-entry" },
        line.isStock
          ? makeBadge("庫存品", "#87d1ff")
          : makeBadge("非庫存品", "#7d7d7d"),
        el("span", { class: "ops-entry-name", title: line.name }, line.name),
        el("span", { class: "ops-entry-qty" }, `${line.quantity}${line.unit || ""}`),
        line.itemId ? itemLocation(line.itemId) : el("span", { class: "ops-entry-location" }, "位置：非庫存品"),
        line.isStock && line.deduct
          ? el("span", { class: "ops-entry-flag" },
              order.status === "prepared" && line.executedQuantity != null
                ? `已扣 ${line.executedQuantity}`
                : "從庫存扣除")
          : el("span", { class: "ops-entry-flag muted" }, "不扣庫存"),
      ));
    }
  }
  card.appendChild(list);

  const actions = el("div", { class: "ops-card-actions" });
  if (order.status === "draft") {
    actions.appendChild(el("button", { class: "btn btn-ghost btn-sm", type: "button", "data-action": "edit-order" }, "編輯"));
    actions.appendChild(el("button", { class: "btn btn-primary btn-sm", type: "button", "data-action": "execute-order" }, "完成備料"));
  }
  actions.appendChild(el("button", { class: "btn btn-ghost btn-sm", type: "button", "data-action": "export-pdf" },
    el("span", { html: icon("clipboard", { size: "14px" }) }), "輸出 PDF"));
  actions.appendChild(el("button", { class: "btn btn-danger btn-sm", type: "button", "data-action": "delete-order" }, "刪除"));
  card.appendChild(actions);
  return card;
}

function wirePrepDelegation() {
  const host = document.getElementById("prep-list");
  if (!host || host.dataset.wired) return;
  host.dataset.wired = "1";
  host.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !host.contains(button)) return;
    const card = event.target.closest("[data-order-id]");
    const order = state.orders.find((candidate) => candidate.id === card?.dataset.orderId);
    if (!order) return;
    if (button.dataset.action === "edit-order") openPrepForm(order);
    else if (button.dataset.action === "execute-order") handleExecuteOrder(order, button);
    else if (button.dataset.action === "export-pdf") exportPrepOrderPdf(order);
    else if (button.dataset.action === "delete-order") handleDeleteOrder(order);
  });
}

/* ---------- BOM PDF ---------- */

function itemLocationText(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return "未分類";
  const storage = state.locationIndex?.storageName(item.storageId) || item.storageId;
  const section = state.locationIndex?.sectionName(item.storageId, item.sectionId) || item.sectionId;
  return formatLocation(storage, section) || "未分類";
}

function exportPrepOrderPdf(order) {
  // 不在 features 傳入 noopener：部分瀏覽器會因此回傳 null，讓 BOM 無法寫入新視窗。
  // 視窗建立後立即切斷 opener，兼顧相容性與安全性。
  const popup = window.open("", "_blank");
  if (!popup) {
    notify.warning("瀏覽器阻擋了 PDF 視窗，請允許此網站開啟彈出式視窗");
    return;
  }
  popup.opener = null;

  const headerUrl = new URL("images/BOM_page_header.png", window.location.href).href;
  const rows = (order.lines || []).map((line, index) => {
    const item = state.items.find((candidate) => candidate.id === line.itemId);
    const notes = [item?.description, ...(item?.tags || []).map((tag) => `#${tag}`)]
      .filter(Boolean).join("；");
    return `<tr>
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(line.name)}</td>
      <td class="number">${escapeHtml(line.quantity)}</td>
      <td class="center">${escapeHtml(line.unit || "—")}</td>
      <td>${escapeHtml(line.itemId ? itemLocationText(line.itemId) : "非庫存品")}</td>
      <td>${escapeHtml(notes || (line.deduct ? "完成時從庫存扣除" : "不從庫存取出"))}</td>
    </tr>`;
  }).join("");

  popup.document.open();
  popup.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
    <title>${escapeHtml(order.name)}－BOM</title>
    <style>
      @page { size: A4 portrait; margin: 10mm 10mm 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font: 10pt/1.45 Arial, "Noto Sans TC", sans-serif; }
      table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      th, td { padding: 5px 6px; vertical-align: middle; overflow-wrap: anywhere; }
      th { background: #e9edf2; text-align: center; font-weight: 700; }
      .column-head th, tbody td {
        border: 0;
        border-right: .3mm solid #111;
        border-bottom: .3mm solid #111;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .column-head th { border-top: .3mm solid #111; }
      .column-head th:first-child, tbody td:first-child { border-left: .3mm solid #111; }
      .page-header { border: 0; padding: 0 0 4mm; background: #fff; text-align: left; }
      .page-header img { display: block; width: 72mm; max-width: 45%; height: auto; max-height: 17mm; object-fit: contain; object-position: left top; }
      .doc-info { border: 0; padding: 0 0 4mm; background: #fff; text-align: left; }
      .doc-info strong { font-size: 16pt; }
      .meta { float: right; color: #444; font-size: 9pt; padding-top: 5px; }
      .center { text-align: center; }
      .number { text-align: right; font-variant-numeric: tabular-nums; }
      .c-no { width: 7%; } .c-name { width: 25%; } .c-qty { width: 9%; }
      .c-unit { width: 9%; } .c-loc { width: 20%; } .c-note { width: 30%; }
    </style></head><body><table>
      <thead>
        <tr><th colspan="6" class="page-header"><img id="bom-header" src="${escapeHtml(headerUrl)}" alt="BOM 頁眉"></th></tr>
        <tr><th colspan="6" class="doc-info"><strong>${escapeHtml(order.name)}</strong><span class="meta">BOM／輸出時間：${escapeHtml(formatDateTime(new Date().toISOString()))}</span></th></tr>
        <tr class="column-head"><th class="c-no">項次</th><th class="c-name">品名</th><th class="c-qty">數量</th><th class="c-unit">單位</th><th class="c-loc">位置</th><th class="c-note">備註</th></tr>
      </thead><tbody>${rows || '<tr><td colspan="6" class="center">此備料單沒有明細</td></tr>'}</tbody>
    </table><script>
      const image = document.getElementById('bom-header');
      const printNow = () => setTimeout(() => { window.focus(); window.print(); }, 150);
      if (image.complete) printNow(); else { image.onload = printNow; image.onerror = printNow; }
    <\/script></body></html>`);
  popup.document.close();
}

/* ---------- 新增／編輯備料單 ---------- */

function openPrepForm(order = null) {
  const isEdit = !!order;
  let lines = (order?.lines || []).map((line) => ({ ...line }));
  let pickedItem = null;

  const body = el("div", { class: "prep-form" });
  body.innerHTML = `
    <div class="field">
      <label for="prep-name">備料單名稱 <span class="req">*</span></label>
      <input id="prep-name" value="${escapeHtml(order?.name || "")}" placeholder="例如：底盤組裝備料" autocomplete="off">
      <div class="error-text" data-for="prep-name"></div>
    </div>
    <div class="prep-line-editor">
      <div class="card-title" style="margin-bottom:8px">新增明細</div>
      <div class="field">
        <label for="prep-item-search">搜尋既有材料（名稱、標籤、說明或種類；可留空瀏覽全部）</label>
        <input id="prep-item-search" type="search" placeholder="搜尋名稱、標籤、說明、種類…" autocomplete="off">
      </div>
      <div class="take-candidates" id="prep-candidates"></div>
      <div id="prep-picked" class="take-selected" hidden><div id="prep-picked-info" class="take-selected-info"></div></div>
      <div class="form-row" style="margin-top:10px">
        <div class="field">
          <label for="prep-line-qty">需求數量</label>
          <input id="prep-line-qty" type="number" min="1" step="1" value="1">
        </div>
        <div class="field">
          <label for="prep-line-unit">單位</label>
          <input id="prep-line-unit" placeholder="顆、包、公尺…" autocomplete="off">
        </div>
      </div>
      <label class="prep-deduct-row" id="prep-deduct-row" hidden>
        <input type="checkbox" id="prep-line-deduct" checked style="width:auto"> 取料時從庫存扣除
      </label>
      <button type="button" class="btn btn-ghost btn-sm" id="prep-add-line"><span class="ico-svg" style="width:14px;height:14px;--icon-url:url('../images/icons/plus.svg')" aria-hidden="true"></span>加入明細</button>
    </div>
    <div class="card-title" style="margin:14px 0 8px">明細（<span id="prep-line-count">0</span>）</div>
    <div class="ops-entry-list" id="prep-lines"></div>
  `;

  const searchInput = body.querySelector("#prep-item-search");
  const candidatesHost = body.querySelector("#prep-candidates");
  const pickedHost = body.querySelector("#prep-picked");
  const pickedInfo = body.querySelector("#prep-picked-info");
  const qtyInput = body.querySelector("#prep-line-qty");
  const unitInput = body.querySelector("#prep-line-unit");
  const deductRow = body.querySelector("#prep-deduct-row");
  const deductInput = body.querySelector("#prep-line-deduct");
  const linesHost = body.querySelector("#prep-lines");
  const lineCount = body.querySelector("#prep-line-count");

  const materials = () => state.items.filter((item) => item.category === "material");

  function renderCandidates() {
    const query = searchInput.value.trim().toLowerCase();
    candidatesHost.replaceChildren();
    const matches = sortByName(materials(), (item) => item.name)
      .filter((item) => {
        if (!query) return true;
        const haystack = [
          item.name,
          ...(item.tags || []),
          item.description,
          item.category,
          item.category === "material" ? "材料" : "工具",
        ].map((value) => String(value || "").toLowerCase()).join(" ");
        return query.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
      })
      .slice(0, 100);
    if (!matches.length) {
      candidatesHost.appendChild(el("div", { class: "section-empty" }, "沒有符合的既有材料 — 會以非庫存品加入。"));
      return;
    }
    for (const item of matches) {
      const row = el("button", { type: "button", class: "take-candidate" + (pickedItem?.id === item.id ? " is-selected" : "") },
        el("span", { class: "take-candidate-name" }, item.name),
        itemLocation(item.id),
        el("span", { class: "take-candidate-avail" }, `庫存 ${formatMaterialQuantity(item)}`),
      );
      row.addEventListener("click", () => {
        pickedItem = item;
        pickedHost.hidden = false;
        pickedInfo.replaceChildren(
          el("strong", {}, item.name),
          el("span", { class: "take-candidate-avail", style: "margin-left:8px" }, `庫存 ${formatMaterialQuantity(item)}`),
        );
        unitInput.value = item.unit || "";
        deductRow.hidden = false;
        renderCandidates();
      });
      candidatesHost.appendChild(row);
    }
  }
  searchInput.addEventListener("input", () => {
    if (pickedItem && searchInput.value.trim() !== pickedItem.name) {
      pickedItem = null;
      pickedHost.hidden = true;
      deductRow.hidden = true;
    }
    renderCandidates();
  });
  searchInput.addEventListener("focus", renderCandidates);
  renderCandidates();

  function renderLines() {
    lineCount.textContent = String(lines.length);
    linesHost.replaceChildren();
    if (!lines.length) {
      linesHost.appendChild(el("div", { class: "section-empty" }, "（尚無明細，先在上面加入材料）"));
      return;
    }
    lines.forEach((line, index) => {
      linesHost.appendChild(el("div", { class: "ops-entry" },
        line.itemId ? makeBadge("庫存品", "#87d1ff") : makeBadge("非庫存品", "#7d7d7d"),
        el("span", { class: "ops-entry-name", title: line.name }, line.name),
        el("span", { class: "ops-entry-qty" }, `${line.quantity}${line.unit || ""}`),
        line.itemId ? itemLocation(line.itemId) : el("span", { class: "ops-entry-location" }, "位置：非庫存品"),
        el("span", { class: "ops-entry-flag" + (line.deduct ? "" : " muted") }, line.deduct ? "扣庫存" : "不扣庫存"),
        el("button", {
          class: "icon-btn danger", type: "button", "aria-label": `移除 ${line.name}`,
          onclick: () => { lines.splice(index, 1); renderLines(); },
        }, "×"),
      ));
    });
  }
  renderLines();

  body.querySelector("#prep-add-line").addEventListener("click", () => {
    const rawName = searchInput.value.trim();
    const name = pickedItem ? pickedItem.name : rawName;
    const quantity = Number(qtyInput.value);
    if (!name) { notify.warning("請先搜尋並選擇材料，或輸入材料名稱"); return; }
    if (!Number.isInteger(quantity) || quantity <= 0) { notify.warning("需求數量必須是正整數"); return; }
    lines.push({
      id: `line-${Date.now()}-${lines.length}`,
      itemId: pickedItem?.id || null,
      name,
      quantity,
      unit: unitInput.value.trim() || pickedItem?.unit || null,
      isStock: !!pickedItem,
      deduct: !!pickedItem && deductInput.checked,
      executedQuantity: null,
    });
    pickedItem = null;
    pickedHost.hidden = true;
    deductRow.hidden = true;
    searchInput.value = "";
    qtyInput.value = "1";
    unitInput.value = "";
    candidatesHost.replaceChildren();
    renderLines();
  });

  const footer = el("div", { style: "display:flex; gap:10px" });
  const cancel = el("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const save = el("button", { type: "button", class: "btn btn-primary" }, isEdit ? "儲存變更" : "建立備料單");
  footer.append(cancel, save);
  const { overlay } = openModal({ title: isEdit ? "編輯備料單" : "新增備料單", body, footer, maxWidth: "600px" });
  overlay.querySelector(".modal")?.classList.add("prep-order-modal");
  cancel.addEventListener("click", () => closeModal());

  save.addEventListener("click", async () => {
    const name = body.querySelector("#prep-name").value.trim();
    if (!name) { showFieldErrors(body, { "prep-name": "請輸入備料單名稱" }); return; }
    if (!lines.length) { notify.warning("備料單至少需要一筆材料明細"); return; }
    save.disabled = true; cancel.disabled = true; save.textContent = "儲存中…";
    try {
      if (isEdit) await updatePrepOrder(order.id, { name, lines });
      else await createPrepOrder({ name, lines });
      notify.success(isEdit ? "已更新備料單" : "已建立備料單");
      closeModal();
      await refreshOps({ boxes: false, items: false });
    } catch (err) {
      console.error(err);
      notify.danger("儲存失敗：" + errorText(err));
      save.disabled = false; cancel.disabled = false;
      save.textContent = isEdit ? "儲存變更" : "建立備料單";
    }
  });
}

/* ---------- 取料 ---------- */

async function handleExecuteOrder(order, button) {
  const deductLines = (order.lines || []).filter((line) => line.deduct && line.itemId);
  const confirmed = await confirmModal({
    title: "完成備料",
    message: `確定執行「${escapeHtml(order.name)}」的備料嗎？`,
    detail: deductLines.length
      ? `將從庫存扣除 ${deductLines.length} 項材料；任一項不足時整筆取消。`
      : "此備料單沒有要扣庫存的明細，只會標記為已備料。",
    confirmText: "執行取料",
  });
  if (!confirmed) return;
  button.disabled = true; // 防止重複點擊造成二次扣庫存
  try {
    await executePrepOrder(order.id);
    notify.success(`「${order.name}」已完成備料`);
    await refreshOps({ boxes: false });
  } catch (err) {
    console.error(err);
    notify.danger(errorText(err), { duration: 8000 });
    button.disabled = false;
    await refreshOps({ boxes: false });
  }
}

async function handleDeleteOrder(order) {
  const confirmed = await confirmModal({
    title: "刪除備料單",
    message: `確定刪除「${escapeHtml(order.name)}」嗎？`,
    detail: "刪除不會回補已扣除的庫存，歷史紀錄（Log）也不會被刪除。需要回補時請用材料的「補充」操作。",
    confirmText: "刪除", danger: true,
  });
  if (!confirmed) return;
  try {
    await deletePrepOrder(order.id);
    notify.success("已刪除備料單");
    await refreshOps({ boxes: false, items: false });
  } catch (err) {
    console.error(err);
    notify.danger(errorText(err));
  }
}

/* ================= 小工具 ================= */

function clearFieldErrors(root) {
  root.querySelectorAll(".error-text").forEach((node) => node.classList.remove("show"));
}

function showFieldErrors(root, errors) {
  for (const [field, message] of Object.entries(errors)) {
    const box = root.querySelector(`.error-text[data-for="${field}"]`);
    if (box) { box.textContent = message; box.classList.add("show"); }
  }
}
