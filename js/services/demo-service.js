// js/services/demo-service.js — localStorage-backed data for demo mode (?demo=1).
//
// Mirrors the function surface of firebase-service.js (fbGetItems, fbCreateItem, ...)
// and user-service.js (getManagedUsers, approvePendingUser, ...) so data-service.js
// and user-service.js can swap this in without callers knowing the difference.
// Nothing here ever reaches Firebase; all state lives in localStorage under
// "workshop.demo.*" keys and is seeded on first use.

import { applyQuantityChange, isToolTakable } from "../utils/item-logic.js";
import { getActiveActor } from "./actor.js";

const ITEMS_KEY = "workshop.demo.items";
const AUTHORIZED_KEY = "workshop.demo.authorizedUsers";
const PENDING_KEY = "workshop.demo.pendingUsers";
const BOXES_KEY = "workshop.demo.usageBoxes";
const PREP_KEY = "workshop.demo.prepOrders";
const LOGS_KEY = "workshop.demo.activityLogs";

function nowIso() {
  return new Date().toISOString();
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled / full — demo mode just stops persisting silently */
  }
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ---------------- seed data ---------------- */

function seedItems() {
  const t = nowIso();
  const base = (overrides) => ({
    tags: [], description: "", imageUrl: "", createdAt: t, updatedAt: t, ...overrides,
  });
  return [
    base({ id: makeId("item"), name: "棘輪扳手組", category: "tool", storageId: "tool-cart-c", sectionId: "c7", status: "available", quantity: 3, totalQuantity: 3, tags: ["常用"] }),
    base({ id: makeId("item"), name: "氣動攻牙機", category: "tool", storageId: "tool-cart-c", sectionId: "c3", status: "available", quantity: 2, totalQuantity: 2 }),
    base({ id: makeId("item"), name: "攻牙鑽", category: "tool", storageId: "tool-cart-c", sectionId: "c3", status: "available", quantity: 25, totalQuantity: 25 }),
    base({ id: makeId("item"), name: "氣動倒角機", category: "tool", storageId: "tool-cart-c", sectionId: "c3", status: "available", quantity: 1, totalQuantity: 1 }),
    base({ id: makeId("item"), name: "風槍", category: "tool", storageId: "tool-cart-c", sectionId: "c7", status: "available", quantity: 1, totalQuantity: 1 }),
    base({ id: makeId("item"), name: "F 夾", category: "tool", storageId: "tool-cart-c", sectionId: "c5", status: "available", quantity: 4, totalQuantity: 5, tags: ["常用"] }),
    base({ id: makeId("item"), name: "氣動釘槍", category: "tool", storageId: "tool-cart-c", sectionId: "c3", status: "in-use", quantity: 0, totalQuantity: 1 }),
    base({ id: makeId("item"), name: "威克士 WORX 電鑽", category: "tool", storageId: "tool-cart-c", sectionId: "c1", status: "available", quantity: 4, totalQuantity: 4 }),
    base({ id: makeId("item"), name: "攻牙鑽夾頭", category: "tool", storageId: "tool-cart-c", sectionId: "c3", status: "available", quantity: 12, totalQuantity: 12 }),
    base({ id: makeId("item"), name: "膠槌", category: "tool", storageId: "tool-cart-c", sectionId: "c5", status: "available", quantity: 2, totalQuantity: 2 }),
    base({ id: makeId("item"), name: "各式膠帶", category: "material", storageId: "tool-cart-c", sectionId: "c6", quantity: 14, minimumQuantity: 20, unit: "捲", quantityMode: "approximate", tags: ["常用"] }),
    base({ id: makeId("item"), name: "M3 螺絲", category: "material", storageId: "quick-box-front", sectionId: "b2", quantity: 320, minimumQuantity: 100, unit: "顆" }),
    base({ id: makeId("item"), name: "束線帶", category: "material", storageId: "quick-box-front", sectionId: "b5", quantity: 8, minimumQuantity: 30, unit: "包" }),
    base({ id: makeId("item"), name: "3D 列印線材", category: "material", storageId: "dry-box-a", sectionId: "t1", quantity: 2, minimumQuantity: 3, unit: "捲", tags: ["軟體"] }),
    base({ id: makeId("item"), name: "碳纖維板", category: "material", storageId: "cabinet-15", sectionId: "s1", quantity: 6, minimumQuantity: 4, unit: "片" }),
    base({ id: makeId("item"), name: "電動起子", category: "tool", storageId: "cabinet-16", sectionId: "s2", status: "available", quantity: 2, totalQuantity: 2 }),
    base({ id: makeId("item"), name: "游標卡尺", category: "tool", storageId: "cabinet-17", sectionId: "s0", status: "wishlist", quantity: 0, totalQuantity: 0 }),
    base({ id: makeId("item"), name: "電木夾", category: "tool", storageId: "pegboard", sectionId: "p11", status: "available", quantity: 6, totalQuantity: 6 }),
    base({ id: makeId("item"), name: "護目鏡", category: "material", storageId: "pegboard", sectionId: "p41", quantity: 5, minimumQuantity: 5, unit: "個" }),
  ];
}

function seedAuthorizedUsers() {
  const t = nowIso();
  return [
    { uid: "demo-user", email: "demo@frc8725-workshop.local", displayName: "示範帳號", photoURL: "", role: "admin", enabled: true, createdAt: t, updatedAt: t },
    { uid: "demo-member-1", email: "member1@example.com", displayName: "示範隊員 A", photoURL: "", role: "member", enabled: true, createdAt: t, updatedAt: t },
  ];
}

function seedPendingUsers() {
  const t = nowIso();
  return [
    { uid: "demo-pending-1", email: "pending1@example.com", displayName: "示範新成員", photoURL: "", requestedAt: t, lastAttemptAt: t },
  ];
}

function loadItems() {
  let items = readJSON(ITEMS_KEY, null);
  if (!items) {
    items = seedItems();
    writeJSON(ITEMS_KEY, items);
  }
  return items;
}
function saveItems(items) { writeJSON(ITEMS_KEY, items); }

function loadAuthorized() {
  let users = readJSON(AUTHORIZED_KEY, null);
  if (!users) {
    users = seedAuthorizedUsers();
    writeJSON(AUTHORIZED_KEY, users);
  }
  return users;
}
function saveAuthorized(users) { writeJSON(AUTHORIZED_KEY, users); }

function loadPending() {
  let users = readJSON(PENDING_KEY, null);
  if (!users) {
    users = seedPendingUsers();
    writeJSON(PENDING_KEY, users);
  }
  return users;
}
function savePending(users) { writeJSON(PENDING_KEY, users); }

/* ---------------- items (mirrors firebase-service.js) ---------------- */

export async function fbGetItems() {
  return loadItems().map((item) => ({ ...item }));
}

export async function fbGetItemById(itemId) {
  const item = loadItems().find((i) => i.id === itemId);
  return item ? { ...item } : null;
}

export async function fbCreateItem(itemData) {
  const items = loadItems();
  const created = { ...itemData, id: makeId("item"), createdAt: nowIso(), updatedAt: nowIso() };
  items.push(created);
  saveItems(items);
  return { ...created };
}

export async function fbUpdateItem(itemId, updates) {
  const items = loadItems();
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
  items[index] = { ...items[index], ...updates, id: itemId, updatedAt: nowIso() };
  saveItems(items);
  return { ...items[index] };
}

export async function fbAdjustItemQuantity(itemId, delta) {
  if (delta !== 1 && delta !== -1) throw new Error("數量調整值必須是 1 或 -1");
  const items = loadItems();
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
  const item = items[index];
  let result;
  try {
    result = applyQuantityChange(item, delta);
  } catch (err) {
    if (err.code === "insufficient") throw Object.assign(new Error("數量已經是 0"), { code: "quantity-empty" });
    if (err.code === "over-total") throw Object.assign(new Error("工具已全部歸還"), { code: "quantity-full" });
    throw err;
  }
  items[index] = { ...item, quantity: result.quantity, status: result.status, updatedAt: nowIso() };
  saveItems(items);
  appendLog({
    action: delta < 0 ? "take" : "return",
    source: "direct",
    item: items[index],
    quantity: Math.abs(delta),
  });
  return { ...items[index] };
}

export async function fbDeleteItem(itemId) {
  saveItems(loadItems().filter((i) => i.id !== itemId));
  return true;
}

/* ---------------- 作業（usageBoxes / prepOrders）與 activityLogs ---------------- */

function loadBoxes() { return readJSON(BOXES_KEY, []); }
function saveBoxes(boxes) { writeJSON(BOXES_KEY, boxes); }
function loadPrepOrders() { return readJSON(PREP_KEY, []); }
function savePrepOrders(orders) { writeJSON(PREP_KEY, orders); }
function loadLogs() { return readJSON(LOGS_KEY, []); }
function saveLogs(logs) { writeJSON(LOGS_KEY, logs); }

function demoActor() {
  const actor = getActiveActor();
  return actor || { uid: "demo-user", name: "示範帳號" };
}

function appendLog({ action, source, item, quantity, userName, userUid, box, prepOrder }) {
  const actor = demoActor();
  const logs = loadLogs();
  logs.push({
    id: makeId("log"),
    action,
    source,
    actorUid: actor.uid,
    actorName: actor.name || "",
    userName: userName || actor.name || "",
    userUid: userUid ?? null,
    itemId: item?.id ?? null,
    itemName: item?.name || "",
    itemCategory: item?.category || null,
    quantity: Number(quantity) || 0,
    unit: item?.unit ?? null,
    boxId: box?.id ?? null,
    boxName: box?.name ?? null,
    prepOrderId: prepOrder?.id ?? null,
    prepOrderName: prepOrder?.name ?? null,
    at: nowIso(),
  });
  saveLogs(logs);
}

export async function fbGetUsageBoxes() {
  return loadBoxes().map((box) => ({ ...box, items: (box.items || []).map((entry) => ({ ...entry })) }));
}

export async function fbCreateUsageBox({ name, userName, userUid }) {
  const actor = demoActor();
  const boxes = loadBoxes();
  const box = {
    id: makeId("box"),
    name: String(name || "").trim(),
    userName: String(userName || "").trim(),
    userUid: userUid || null,
    createdByUid: actor.uid,
    createdByName: actor.name || "",
    status: "active",
    items: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  boxes.push(box);
  saveBoxes(boxes);
  return { ...box };
}

export async function fbBoxTransferItem({ boxId, itemId, quantity, action }) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw Object.assign(new Error("數量必須是正整數"), { code: "invalid-quantity" });
  if (action !== "take" && action !== "return") throw new Error("未知的操作");

  const boxes = loadBoxes();
  const items = loadItems();
  const boxIndex = boxes.findIndex((b) => b.id === boxId);
  const itemIndex = items.findIndex((i) => i.id === itemId);
  if (boxIndex < 0) throw Object.assign(new Error("找不到盒子"), { code: "not-found" });
  if (itemIndex < 0) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
  const box = { ...boxes[boxIndex], items: (boxes[boxIndex].items || []).map((entry) => ({ ...entry })) };
  const item = items[itemIndex];
  if (box.status === "closed") throw Object.assign(new Error("此盒子已結束，無法再操作"), { code: "box-closed" });
  if (action === "take" && item.category === "tool" && !isToolTakable(item)) {
    throw Object.assign(new Error(`「${item.name}」為特殊狀態，無法取用`), { code: "special-status" });
  }

  const index = box.items.findIndex((entry) => entry.itemId === itemId);
  const held = index >= 0 ? Math.max(0, Number(box.items[index].quantity) || 0) : 0;
  if (action === "return" && qty > held) {
    throw Object.assign(new Error(`歸還數量不可超過盒內持有量（${held}）`), { code: "over-held" });
  }

  // 先驗證再寫入：applyQuantityChange 丟錯時不會留下部分變更（demo 版的原子性）
  const result = applyQuantityChange(item, action === "take" ? -qty : qty);
  const nextHeld = action === "take" ? held + qty : held - qty;
  if (index >= 0) {
    if (nextHeld === 0) box.items.splice(index, 1);
    else box.items[index].quantity = nextHeld;
  } else {
    box.items.push({ itemId, name: item.name || "", category: item.category || null, unit: item.unit ?? null, quantity: nextHeld });
  }

  items[itemIndex] = { ...item, quantity: result.quantity, status: result.status, updatedAt: nowIso() };
  box.updatedAt = nowIso();
  boxes[boxIndex] = box;
  saveItems(items);
  saveBoxes(boxes);
  appendLog({
    action, source: "box",
    userName: box.userName, userUid: box.userUid ?? null,
    item: items[itemIndex], quantity: qty, box,
  });
  return { box: { ...box }, item: { ...items[itemIndex] } };
}

export async function fbBoxTakeItems({ boxId, entries }) {
  const wanted = new Map();
  for (const entry of entries || []) {
    const qty = Number(entry.quantity);
    if (!entry.itemId) continue;
    if (!Number.isInteger(qty) || qty <= 0) throw Object.assign(new Error("數量必須是正整數"), { code: "invalid-quantity" });
    wanted.set(entry.itemId, (wanted.get(entry.itemId) || 0) + qty);
  }
  if (!wanted.size) throw Object.assign(new Error("請至少選擇一個品項"), { code: "invalid-quantity" });

  const boxes = loadBoxes();
  const items = loadItems();
  const boxIndex = boxes.findIndex((b) => b.id === boxId);
  if (boxIndex < 0) throw Object.assign(new Error("找不到盒子"), { code: "not-found" });
  const box = { ...boxes[boxIndex], items: (boxes[boxIndex].items || []).map((entry) => ({ ...entry })) };
  if (box.status === "closed") throw Object.assign(new Error("此盒子已結束，無法再操作"), { code: "box-closed" });

  // 先全部驗證與試算，再一次寫入（demo 版原子性）。
  const staged = [];
  for (const [itemId, qty] of wanted) {
    const itemIndex = items.findIndex((i) => i.id === itemId);
    if (itemIndex < 0) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
    const item = items[itemIndex];
    if (item.category === "tool" && !isToolTakable(item)) {
      throw Object.assign(new Error(`「${item.name}」為特殊狀態，無法取用`), { code: "special-status" });
    }
    let result;
    try { result = applyQuantityChange(item, -qty); }
    catch (err) {
      if (err.code === "insufficient") {
        const avail = Math.max(0, Number(item.quantity) || 0);
        throw Object.assign(new Error(`「${item.name}」可用數量不足（需 ${qty}，剩 ${avail}）`), { code: "insufficient" });
      }
      throw err;
    }
    staged.push({ itemIndex, item, qty, result });
  }

  for (const { itemIndex, item, qty, result } of staged) {
    const entryIndex = box.items.findIndex((entry) => entry.itemId === item.id);
    const held = entryIndex >= 0 ? Math.max(0, Number(box.items[entryIndex].quantity) || 0) : 0;
    if (entryIndex >= 0) box.items[entryIndex].quantity = held + qty;
    else box.items.push({ itemId: item.id, name: item.name || "", category: item.category || null, unit: item.unit ?? null, quantity: held + qty });
    items[itemIndex] = { ...item, quantity: result.quantity, status: result.status, updatedAt: nowIso() };
  }
  box.updatedAt = nowIso();
  boxes[boxIndex] = box;
  saveItems(items);
  saveBoxes(boxes);
  for (const { itemIndex, qty } of staged) {
    appendLog({ action: "take", source: "box", userName: box.userName, userUid: box.userUid ?? null, item: items[itemIndex], quantity: qty, box });
  }
  return { box: { ...box } };
}

export async function fbCloseUsageBox(boxId) {
  const boxes = loadBoxes();
  const index = boxes.findIndex((b) => b.id === boxId);
  if (index < 0) throw Object.assign(new Error("找不到盒子"), { code: "not-found" });
  const hasUnreturnedTools = (boxes[index].items || []).some((entry) =>
    entry.category === "tool" && (Number(entry.quantity) || 0) > 0);
  if (hasUnreturnedTools) {
    throw Object.assign(new Error("盒內仍有未歸還工具，無法標記結束"), { code: "box-not-empty" });
  }
  boxes[index] = { ...boxes[index], status: "closed", updatedAt: nowIso() };
  saveBoxes(boxes);
  return true;
}

export async function fbDeleteUsageBox(boxId) {
  const boxes = loadBoxes();
  const box = boxes.find((b) => b.id === boxId);
  const hasUnreturnedTools = (box?.items || []).some((entry) =>
    entry.category === "tool" && (Number(entry.quantity) || 0) > 0);
  if (hasUnreturnedTools) {
    throw Object.assign(new Error("盒內仍有未歸還工具，無法刪除盒子"), { code: "box-not-empty" });
  }
  saveBoxes(boxes.filter((b) => b.id !== boxId));
  return true;
}

export async function fbGetPrepOrders() {
  return loadPrepOrders().map((order) => ({ ...order, lines: (order.lines || []).map((line) => ({ ...line })) }));
}

function demoSanitizeLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => ({
    id: line.id || `line-${index + 1}`,
    itemId: line.itemId || null,
    name: String(line.name || "").trim(),
    quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
    unit: line.unit ?? null,
    isStock: !!line.itemId,
    deduct: !!line.itemId && !!line.deduct,
    executedQuantity: line.executedQuantity ?? null,
  }));
}

export async function fbCreatePrepOrder({ name, lines }) {
  const actor = demoActor();
  const orders = loadPrepOrders();
  const order = {
    id: makeId("prep"),
    name: String(name || "").trim(),
    createdByUid: actor.uid,
    createdByName: actor.name || "",
    status: "draft",
    lines: demoSanitizeLines(lines),
    preparedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  orders.push(order);
  savePrepOrders(orders);
  return { ...order };
}

export async function fbUpdatePrepOrder(orderId, { name, lines }) {
  const orders = loadPrepOrders();
  const index = orders.findIndex((o) => o.id === orderId);
  if (index < 0) throw Object.assign(new Error("找不到備料單"), { code: "not-found" });
  if (orders[index].status !== "draft") {
    throw Object.assign(new Error("已備料的備料單無法編輯"), { code: "order-not-draft" });
  }
  orders[index] = {
    ...orders[index],
    name: String(name || "").trim(),
    lines: demoSanitizeLines(lines),
    updatedAt: nowIso(),
  };
  savePrepOrders(orders);
  return true;
}

export async function fbExecutePrepOrder(orderId) {
  const orders = loadPrepOrders();
  const items = loadItems();
  const orderIndex = orders.findIndex((o) => o.id === orderId);
  if (orderIndex < 0) throw Object.assign(new Error("找不到備料單"), { code: "not-found" });
  const order = { ...orders[orderIndex], lines: (orders[orderIndex].lines || []).map((line) => ({ ...line })) };
  if (order.status !== "draft") {
    throw Object.assign(new Error("此備料單已完成備料，不可重複取料"), { code: "order-not-draft" });
  }

  const deductLines = order.lines.filter((line) => line.deduct && line.itemId);
  const shortages = [];
  const plans = new Map();
  for (const line of deductLines) {
    const itemIndex = items.findIndex((i) => i.id === line.itemId);
    if (itemIndex < 0) { shortages.push(`${line.name}（品項已不存在）`); continue; }
    const item = items[itemIndex];
    if (item.category !== "material") { shortages.push(`${line.name}（非材料，無法扣庫存）`); continue; }
    const already = plans.get(line.itemId)?.nextQuantity ?? Math.max(0, Number(item.quantity) || 0);
    const next = already - line.quantity;
    if (next < 0) { shortages.push(`${line.name}（需 ${line.quantity}，剩 ${already}）`); continue; }
    plans.set(line.itemId, { itemIndex, item, nextQuantity: next });
  }
  if (shortages.length) {
    throw Object.assign(
      new Error(`庫存不足，整筆取消：${shortages.join("、")}`),
      { code: "insufficient", shortages },
    );
  }

  // 全部驗證通過後才一次寫入（demo 版的原子性）
  for (const plan of plans.values()) {
    items[plan.itemIndex] = { ...plan.item, quantity: plan.nextQuantity, updatedAt: nowIso() };
  }
  for (const line of order.lines) {
    if (line.deduct && line.itemId) line.executedQuantity = line.quantity;
  }
  order.status = "prepared";
  order.preparedAt = nowIso();
  order.updatedAt = nowIso();
  orders[orderIndex] = order;
  saveItems(items);
  savePrepOrders(orders);
  for (const line of deductLines) {
    const plan = plans.get(line.itemId);
    appendLog({
      action: "take", source: "prep",
      item: { ...plan.item, quantity: plan.nextQuantity }, quantity: line.quantity,
      prepOrder: order,
    });
  }
  return { ...order };
}

export async function fbDeletePrepOrder(orderId) {
  savePrepOrders(loadPrepOrders().filter((o) => o.id !== orderId));
  return true;
}

export async function fbGetLogs({ max = 500 } = {}) {
  return loadLogs()
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, max)
    .map((log) => ({ ...log }));
}

export async function fbClearLogs() {
  const count = loadLogs().length;
  saveLogs([]);
  return count;
}

/* ---------------- users (mirrors user-service.js) ---------------- */

export async function demoGetManagedUsers() {
  return { authorized: loadAuthorized().map((u) => ({ ...u })), pending: loadPending().map((u) => ({ ...u })) };
}

export async function demoApprovePendingUser(pendingUser, { displayName, role }) {
  const authorized = loadAuthorized();
  authorized.push({
    uid: pendingUser.uid,
    email: pendingUser.email || "",
    displayName: (displayName || "").trim() || pendingUser.displayName || "",
    enabled: true,
    role: role === "admin" ? "admin" : "member",
    photoURL: pendingUser.photoURL || "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  saveAuthorized(authorized);
  savePending(loadPending().filter((u) => u.uid !== pendingUser.uid));
}

export async function demoUpdateAuthorizedUser(uid, { displayName, role }) {
  const authorized = loadAuthorized();
  const index = authorized.findIndex((u) => u.uid === uid);
  if (index < 0) throw Object.assign(new Error("找不到使用者"), { code: "not-found" });
  authorized[index] = {
    ...authorized[index],
    displayName: (displayName || "").trim(),
    role: role === "admin" ? "admin" : "member",
    updatedAt: nowIso(),
  };
  saveAuthorized(authorized);
}

export async function demoDeleteAuthorizedUser(uid) {
  saveAuthorized(loadAuthorized().filter((u) => u.uid !== uid));
}

export async function demoDeletePendingUser(uid) {
  savePending(loadPending().filter((u) => u.uid !== uid));
}
