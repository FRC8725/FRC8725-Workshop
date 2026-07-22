// js/item-form.js — reusable add/edit item modal

import { el, escapeHtml, hexToRgba, UNITS } from "../utils/utils.js";
import { deriveToolStatus } from "../utils/item-logic.js";
import { openModal, closeModal } from "./modal.js";
import { getAllAreas, getStructureById, createItem, updateItem } from "../services/data-service.js";
import { initLabels, statusList, categoryList, tagList, tagChip } from "./labels.js";
import { notify } from "./notifications.js";
import { firestoreErrorMessage } from "../services/auth-service.js";

/**
 * Open the item form.
 * @param {object} cfg
 * @param {object|null} cfg.item - existing item for edit, or null for create
 * @param {object} cfg.defaults - {storageId, sectionId} pre-selection
 * @param {Function} cfg.onSaved - called with saved item
 */
export async function openItemForm({ item = null, defaults = {}, onSaved } = {}) {
  await initLabels();
  // The form is shared by every page, so its storage choices must include
  // cabinets from every configured floor plan, not only workshop-map.json.
  const areas = await getAllAreas();
  const isEdit = !!item;
  const data = normalizeItem(item, defaults);

  const form = el("form", { class: "item-form", novalidate: "novalidate" });
  form.innerHTML = buildFormHtml(areas, data, isEdit);

  // --- element refs ---
  const catInputs = form.querySelectorAll('input[name="category"]');
  const storageSel = form.querySelector('[name="storageId"]');
  const sectionSel = form.querySelector('[name="sectionId"]');
  const toolFields = form.querySelector("#tool-fields");
  const materialFields = form.querySelector("#material-fields");
  const tagInput = form.querySelector("#tag-input");
  const tagHost = form.querySelector("#tag-host");

  let tags = [...(data.tags || [])];

  function renderTags() {
    tagHost.innerHTML = "";
    tags.forEach((t) => {
      tagHost.appendChild(tagChip(t, {
        removable: true,
        onRemove: (name) => { tags = tags.filter((x) => x !== name); renderTags(); },
      }));
    });
  }
  renderTags();

  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput.value);
      tagInput.value = "";
    }
  });
  function addTag(raw) {
    const t = String(raw || "").trim().replace(/^#/, "");
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      notify.warning("標籤已存在");
      return;
    }
    tags.push(t);
    renderTags();
  }
  form.querySelector("#tag-suggest").addEventListener("click", (e) => {
    if (e.target.dataset.tag) addTag(e.target.dataset.tag);
  });

  async function populateSections(structureId, selectedSection) {
    const area = areas.find((a) => a.id === storageSel.value);
    sectionSel.innerHTML = "";
    if (!area) return;
    const structure = await getStructureById(area.structureId);
    if (!structure) return;
    for (const sec of structure.sections || []) {
      const opt = el("option", { value: sec.id }, sec.name);
      if (sec.id === selectedSection) opt.selected = true;
      sectionSel.appendChild(opt);
    }
  }
  await populateSections(null, data.sectionId);
  storageSel.addEventListener("change", () => populateSections(null, null));

  function syncCategory() {
    const cat = form.querySelector('input[name="category"]:checked').value;
    toolFields.style.display = cat === "tool" ? "" : "none";
    materialFields.style.display = cat === "material" ? "" : "none";
  }
  catInputs.forEach((r) => r.addEventListener("change", syncCategory));
  syncCategory();

  // --- footer buttons ---
  const footer = el("div", { style: "display:flex; gap:10px" });
  const cancelBtn = el("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const saveBtn = el("button", { type: "submit", class: "btn btn-primary", form: "" }, isEdit ? "儲存變更" : "新增物品");
  footer.append(cancelBtn, saveBtn);

  openModal({
    title: isEdit ? "編輯物品" : "新增物品",
    body: form,
    footer,
    maxWidth: "560px",
  });
  cancelBtn.addEventListener("click", () => closeModal());
  saveBtn.addEventListener("click", (e) => { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(form);
    const payload = collectPayload(form, tags);
    const errors = validate(payload);
    if (Object.keys(errors).length) {
      showErrors(form, errors);
      notify.danger("請修正表單中的錯誤");
      return;
    }
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = "儲存中…";
    try {
      const saved = isEdit
        ? await updateItem(item.id, payload, item)
        : await createItem(payload);
      notify.success(isEdit ? "已更新物品" : "已新增物品");
      closeModal();
      if (onSaved) onSaved(saved);
    } catch (err) {
      console.error(err);
      notify.danger("儲存失敗：" + firestoreErrorMessage(err));
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = isEdit ? "儲存變更" : "新增物品";
    }
  });
}

/* ---------------- helpers ---------------- */

function normalizeItem(item, defaults) {
  const category = item?.category || "tool";
  return {
    name: item?.name || "",
    category,
    storageId: item?.storageId || defaults.storageId || "",
    sectionId: item?.sectionId || defaults.sectionId || "",
    status: item?.status || "available",
    quantity: item?.quantity ?? (category === "tool" ? 1 : ""),
    totalQuantity: item?.totalQuantity ?? item?.quantity ?? (category === "tool" ? 1 : ""),
    quantityMode: item?.quantityMode || "approximate",
    unit: item?.unit || "個",
    minimumQuantity: item?.minimumQuantity ?? "",
    tags: item?.tags || [],
    description: item?.description || "",
    imageUrl: item?.imageUrl || "",
  };
}

function buildFormHtml(areas, d, isEdit) {
  const areaOpts = areas.map((a) =>
    `<option value="${escapeHtml(a.id)}" ${a.id === d.storageId ? "selected" : ""}>${escapeHtml(a.name)}</option>`
  ).join("");
  const statusOpts = statusList().map((s) =>
    `<option value="${escapeHtml(s.name)}" ${s.name === d.status ? "selected" : ""}>${escapeHtml(s.label)}</option>`
  ).join("");
  const unitOpts = UNITS.map((u) =>
    `<option value="${u}" ${u === d.unit ? "selected" : ""}>${u}</option>`
  ).join("");
  const cats = categoryList();
  const catRadios = cats.map((c) => `
        <label style="display:flex; align-items:center; gap:6px; font-weight:600; color:var(--text)">
          <input type="radio" name="category" value="${escapeHtml(c.name)}" ${c.name === d.category ? "checked" : ""} style="width:auto"> ${escapeHtml(c.label)}
        </label>`).join("");
  const suggestChips = tagList().map((t) =>
    `<button type="button" class="chip" data-tag="${escapeHtml(t.name)}" `
    + `style="color:${t.color}; border-color:${hexToRgba(t.color, 0.5)}; background:${hexToRgba(t.color, 0.12)}">#${escapeHtml(t.label)}</button>`
  ).join("");

  return `
    <div class="field">
      <label for="f-name">名稱 <span class="req">*</span></label>
      <input id="f-name" name="name" value="${escapeHtml(d.name)}" placeholder="例如：12V 電動起子" autocomplete="off">
      <div class="error-text" data-for="name"></div>
    </div>

    <div class="field">
      <label>類型 <span class="req">*</span></label>
      <div style="display:flex; gap:18px; margin-top:2px">${catRadios}
      </div>
    </div>

    <div class="form-row">
      <div class="field">
        <label for="f-storage">所屬櫃子 <span class="req">*</span></label>
        <select id="f-storage" name="storageId"><option value="">請選擇…</option>${areaOpts}</select>
        <div class="error-text" data-for="storageId"></div>
      </div>
      <div class="field">
        <label for="f-section">抽屜／層板／格</label>
        <select id="f-section" name="sectionId"></select>
      </div>
    </div>

    <div id="tool-fields">
      <div class="form-row">
        <div class="field">
          <label for="f-status">工具狀態</label>
          <select id="f-status" name="status">${statusOpts}</select>
        </div>
        ${isEdit ? `
          <div class="field">
            <label for="f-tool-qty">可用數量</label>
            <input id="f-tool-qty" name="toolQuantity" type="number" min="0" step="1" value="${escapeHtml(d.quantity)}" placeholder="例如：1">
            <div class="error-text" data-for="toolQuantity"></div>
          </div>
        ` : ""}
        <div class="field">
          <label for="f-tool-total">總數量</label>
          <input id="f-tool-total" name="totalQuantity" type="number" min="0" step="1" value="${escapeHtml(d.totalQuantity)}" placeholder="例如：3">
          <div class="error-text" data-for="totalQuantity"></div>
        </div>
      </div>
    </div>

    <div id="material-fields">
      <div class="form-row">
        <div class="field">
          <label for="f-qty">數量</label>
          <input id="f-qty" name="quantity" type="number" min="0" step="1" value="${escapeHtml(d.quantity)}" placeholder="例如：120">
          <div class="error-text" data-for="quantity"></div>
        </div>
        <div class="field">
          <label for="f-qmode">數量模式</label>
          <select id="f-qmode" name="quantityMode">
            <option value="approximate" ${d.quantityMode === "approximate" ? "selected" : ""}>大約</option>
            <option value="exact" ${d.quantityMode === "exact" ? "selected" : ""}>精確</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="f-unit">單位</label>
          <select id="f-unit" name="unit">${unitOpts}</select>
        </div>
        <div class="field">
          <label for="f-min">最低存量</label>
          <input id="f-min" name="minimumQuantity" type="number" min="0" step="1" value="${escapeHtml(d.minimumQuantity)}" placeholder="低於此值時警示">
        </div>
      </div>
    </div>

    <div class="field">
      <label for="tag-input">標籤（輸入後按 Enter）</label>
      <input id="tag-input" placeholder="例如：常用、五金…" autocomplete="off">
      <div class="tag-list" id="tag-host" style="margin-top:8px"></div>
      <div class="tag-list" id="tag-suggest" style="margin-top:8px; opacity:0.85">${suggestChips}</div>
    </div>

    <div class="field">
      <label for="f-desc">說明</label>
      <textarea id="f-desc" name="description" placeholder="規格、備註…">${escapeHtml(d.description)}</textarea>
    </div>

    <div class="field">
      <label for="f-img">圖片網址</label>
      <input id="f-img" name="imageUrl" value="${escapeHtml(d.imageUrl)}" placeholder="https://…（選填）">
    </div>
  `;
}

function collectPayload(form, tags) {
  const category = form.querySelector('input[name="category"]:checked').value;
  const get = (n) => form.querySelector(`[name="${n}"]`)?.value?.trim() ?? "";
  const payload = {
    name: get("name"),
    category,
    storageId: get("storageId"),
    sectionId: get("sectionId"),
    tags,
    description: get("description"),
    imageUrl: get("imageUrl"),
  };
  if (category === "tool") {
    const q = get("toolQuantity");
    const total = get("totalQuantity");
    payload.totalQuantity = total === "" ? 0 : Number(total);
    payload.quantity = q === "" ? payload.totalQuantity : Number(q);
    // 一般庫存狀態依數量自動推導（quantity < total → in-use）；特殊狀態維持使用者選擇。
    payload.status = deriveToolStatus(get("status") || "available", payload.quantity, payload.totalQuantity);
    payload.unit = null;
    payload.minimumQuantity = null;
    payload.quantityMode = null;
  } else {
    payload.status = "available";
    const q = get("quantity");
    const min = get("minimumQuantity");
    payload.quantity = q === "" ? 0 : Number(q);
    payload.minimumQuantity = min === "" ? 0 : Number(min);
    payload.unit = get("unit") || "個";
    payload.quantityMode = get("quantityMode") || "approximate";
  }
  return payload;
}

function validate(p) {
  const errors = {};
  if (!p.name) errors.name = "請輸入名稱";
  if (!p.storageId) errors.storageId = "請選擇所屬櫃子";
  if (p.quantity != null && (!Number.isInteger(p.quantity) || Number(p.quantity) < 0)) {
    errors[p.category === "tool" ? "toolQuantity" : "quantity"] = "數量必須是零或正整數";
  }
  if (p.category === "tool") {
    if (!Number.isInteger(p.totalQuantity) || p.totalQuantity < 0) errors.totalQuantity = "總數量必須是零或正整數";
    else if (p.quantity > p.totalQuantity) errors.toolQuantity = "可用數量不可大於總數量";
  }
  return errors;
}

function clearErrors(form) {
  form.querySelectorAll(".error-text").forEach((e) => e.classList.remove("show"));
  form.querySelectorAll(".field-error").forEach((e) => e.classList.remove("field-error"));
}

function showErrors(form, errors) {
  for (const [field, msg] of Object.entries(errors)) {
    const box = form.querySelector(`.error-text[data-for="${field}"]`);
    if (box) { box.textContent = msg; box.classList.add("show"); }
    const input = form.querySelector(`[name="${field}"]`);
    if (input) input.classList.add("field-error");
  }
}
