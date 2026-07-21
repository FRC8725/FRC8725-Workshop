// js/firebase-service.js
//
// 封裝所有 Firestore 操作。此檔案「只」在 Firebase 已設定時才會被載入使用。
// 其他頁面不應直接呼叫這裡的函式 —— 請透過 data-service.js / ops-service.js。
//
// 涉及庫存的多文件更新（盒子取用／歸還、備料取料）一律使用 runTransaction，
// 確保庫存、盒子／備料單內容與 activityLogs 全部成功或全部失敗，
// 並在交易內重新讀取最新庫存，避免並行操作覆寫。

import { getFirebaseDb } from "../core/firebase-client.js";
import { applyQuantityChange, isToolTakable } from "../utils/item-logic.js";
import { getActiveActor } from "./actor.js";
import { debugLog } from "../core/debug-mode.js";

const COLLECTION = "items";
const BOXES = "usageBoxes";
const PREP = "prepOrders";
const LOGS = "activityLogs";
const CACHE_META = "system/cacheVersions";

let db = null;
let sdk = null;
let itemsVersionPromise = null;
let knownItemsVersion = null;
let itemsVersionCheckedAt = 0;
const VERSION_RECHECK_MS = 5 * 60 * 1000;

/** 初始化 Firebase App 與 Firestore（動態載入 CDN 模組）。 */
export async function initFirebase() {
  if (db) return db;

  const client = await getFirebaseDb();
  db = client.db;
  sdk = client.sdk;
  return db;
}

function mapDoc(docSnap) {
  const data = docSnap.data() || {};
  return { ...data, id: docSnap.id };
}

function logFirestoreRead(target, detail = "") {
  debugLog(`[Firestore 讀取] ${target}${detail ? `｜${detail}` : ""}`);
}

function requireActor() {
  const actor = getActiveActor();
  if (!actor?.uid) throw Object.assign(new Error("登入狀態已失效，請重新登入。"), { code: "unauthenticated" });
  return actor;
}

function nextVersionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cacheMetaRef() {
  return sdk.doc(db, CACHE_META);
}

function writeItemsVersion(writer) {
  const version = nextVersionId();
  writer.set(cacheMetaRef(), { items: version, updatedAt: sdk.serverTimestamp() }, { merge: true });
  return version;
}

function rememberItemsVersion(version) {
  knownItemsVersion = version;
  itemsVersionPromise = Promise.resolve(version);
  itemsVersionCheckedAt = Date.now();
}

/** 每次 app session 只讀一次版本文件。 */
export async function fbGetItemsVersion() {
  await initFirebase();
  if (!itemsVersionPromise || Date.now() - itemsVersionCheckedAt >= VERSION_RECHECK_MS) {
    logFirestoreRead(CACHE_META, "檢查庫存版本");
    itemsVersionCheckedAt = Date.now();
    itemsVersionPromise = sdk.getDoc(cacheMetaRef()).then((snap) => {
      knownItemsVersion = snap.exists() ? String(snap.data().items || "") : "";
      return knownItemsVersion;
    }).catch((error) => {
      itemsVersionPromise = null;
      itemsVersionCheckedAt = 0;
      throw error;
    });
  }
  return itemsVersionPromise;
}

/** 舊專案第一次使用快取時建立基準版本。 */
export async function fbEnsureItemsVersion() {
  const existing = await fbGetItemsVersion();
  if (existing) return existing;
  const version = nextVersionId();
  await sdk.setDoc(cacheMetaRef(), { items: version, updatedAt: sdk.serverTimestamp() }, { merge: true });
  knownItemsVersion = version;
  itemsVersionPromise = Promise.resolve(version);
  itemsVersionCheckedAt = Date.now();
  return version;
}

/** activityLogs 文件（在交易內建立；at 一律為 server timestamp）。 */
function buildLogPayload({ action, source, actor, userName, userUid, item, quantity, box, prepOrder }) {
  return {
    action,                                   // "take" | "return"
    source,                                   // "box" | "prep" | "direct"
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
    at: sdk.serverTimestamp(),
  };
}

/* ================= items ================= */

export async function fbGetItems() {
  await initFirebase();
  logFirestoreRead(COLLECTION, "完整庫存");
  const snap = await sdk.getDocs(sdk.collection(db, COLLECTION));
  return snap.docs.map(mapDoc);
}

/** 儲位頁只讀目前打開的儲位，不掃描整個工作室。 */
export async function fbGetItemsByStorageId(storageId) {
  await initFirebase();
  logFirestoreRead(COLLECTION, `儲位分段 storageId=${storageId}`);
  const q = sdk.query(
    sdk.collection(db, COLLECTION),
    sdk.where("storageId", "==", storageId),
  );
  const snap = await sdk.getDocs(q);
  return snap.docs.map(mapDoc);
}

export async function fbGetItemById(itemId) {
  await initFirebase();
  logFirestoreRead(`${COLLECTION}/${itemId}`, "單筆物品");
  const ref = sdk.doc(db, COLLECTION, itemId);
  const snap = await sdk.getDoc(ref);
  return snap.exists() ? mapDoc(snap) : null;
}

export async function fbCreateItem(itemData) {
  await initFirebase();
  const payload = {
    ...itemData,
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  };
  delete payload.id;
  const ref = sdk.doc(sdk.collection(db, COLLECTION));
  const batch = sdk.writeBatch(db);
  batch.set(ref, payload);
  const version = writeItemsVersion(batch);
  await batch.commit();
  rememberItemsVersion(version);
  return { ...itemData, id: ref.id };
}

export async function fbUpdateItem(itemId, updates) {
  await initFirebase();
  const ref = sdk.doc(db, COLLECTION, itemId);
  const payload = { ...updates, updatedAt: sdk.serverTimestamp() };
  delete payload.id;
  const batch = sdk.writeBatch(db);
  batch.update(ref, payload);
  const version = writeItemsVersion(batch);
  await batch.commit();
  rememberItemsVersion(version);
  return { ...updates, id: itemId };
}

/** Atomically adjust quantity (quick 使用／歸還 buttons). Also syncs tool status. */
export async function fbAdjustItemQuantity(itemId, delta) {
  await initFirebase();
  if (delta !== 1 && delta !== -1) throw new Error("數量調整值必須是 1 或 -1");
  const actor = requireActor();
  const ref = sdk.doc(db, COLLECTION, itemId);
  let committedVersion = null;
  const updated = await sdk.runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
    const item = { ...snap.data(), id: itemId };
    let result;
    try {
      result = applyQuantityChange(item, delta);
    } catch (err) {
      if (err.code === "insufficient") throw Object.assign(new Error("數量已經是 0"), { code: "quantity-empty" });
      if (err.code === "over-total") throw Object.assign(new Error("工具已全部歸還"), { code: "quantity-full" });
      throw err;
    }
    transaction.update(ref, { quantity: result.quantity, status: result.status, updatedAt: sdk.serverTimestamp() });
    committedVersion = writeItemsVersion(transaction);
    return { ...item, quantity: result.quantity, status: result.status };
  });
  rememberItemsVersion(committedVersion);
  // direct log 是 best-effort：寫在交易外，rules 尚未更新（activityLogs 不存在）時
  // 不影響快速使用／歸還本身。盒子與備料的 log 仍在各自交易內、保證原子性。
  try {
    await sdk.addDoc(sdk.collection(db, LOGS), buildLogPayload({
      action: delta < 0 ? "take" : "return",
      source: "direct",
      actor,
      item: updated,
      quantity: Math.abs(delta),
    }));
  } catch (err) {
    console.warn("direct log 寫入失敗（不影響數量調整）。請確認已發布最新 firestore.rules。", err);
  }
  return updated;
}

export async function fbDeleteItem(itemId) {
  await initFirebase();
  const batch = sdk.writeBatch(db);
  batch.delete(sdk.doc(db, COLLECTION, itemId));
  const version = writeItemsVersion(batch);
  await batch.commit();
  rememberItemsVersion(version);
  return true;
}

/* ================= usageBoxes ================= */

export async function fbGetUsageBoxes() {
  await initFirebase();
  logFirestoreRead(BOXES, "使用紀錄");
  const snap = await sdk.getDocs(sdk.collection(db, BOXES));
  return snap.docs.map(mapDoc);
}

export async function fbCreateUsageBox({ name, userName, userUid }) {
  await initFirebase();
  const actor = requireActor();
  const payload = {
    name: String(name || "").trim(),
    userName: String(userName || "").trim(),
    userUid: userUid || null,
    createdByUid: actor.uid,
    createdByName: actor.name || "",
    status: "active",
    items: [],
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  };
  const ref = await sdk.addDoc(sdk.collection(db, BOXES), payload);
  return { ...payload, id: ref.id };
}

/**
 * 盒子取用／歸還。單一交易內：驗證並更新物品庫存與狀態、更新盒內明細、寫入 log。
 * @param {{boxId:string, itemId:string, quantity:number, action:"take"|"return"}} cfg
 */
export async function fbBoxTransferItem({ boxId, itemId, quantity, action }) {
  await initFirebase();
  const actor = requireActor();
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw Object.assign(new Error("數量必須是正整數"), { code: "invalid-quantity" });
  if (action !== "take" && action !== "return") throw new Error("未知的操作");

  const boxRef = sdk.doc(db, BOXES, boxId);
  const itemRef = sdk.doc(db, COLLECTION, itemId);

  let committedVersion = null;
  const resultValue = await sdk.runTransaction(db, async (transaction) => {
    const [boxSnap, itemSnap] = await Promise.all([transaction.get(boxRef), transaction.get(itemRef)]);
    if (!boxSnap.exists()) throw Object.assign(new Error("找不到盒子"), { code: "not-found" });
    if (!itemSnap.exists()) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
    const box = { ...boxSnap.data(), id: boxId };
    const item = { ...itemSnap.data(), id: itemId };
    if (box.status === "closed") throw Object.assign(new Error("此盒子已結束，無法再操作"), { code: "box-closed" });
    if (action === "take" && item.category === "tool" && !isToolTakable(item)) {
      throw Object.assign(new Error(`「${item.name}」為特殊狀態，無法取用`), { code: "special-status" });
    }

    const entries = Array.isArray(box.items) ? box.items.map((entry) => ({ ...entry })) : [];
    const index = entries.findIndex((entry) => entry.itemId === itemId);
    const held = index >= 0 ? Math.max(0, Number(entries[index].quantity) || 0) : 0;

    if (action === "return" && qty > held) {
      throw Object.assign(new Error(`歸還數量不可超過盒內持有量（${held}）`), { code: "over-held" });
    }

    // 庫存端：取用是扣（-qty）、歸還是補（+qty）。邊界與工具狀態由 applyQuantityChange 統一處理。
    const result = applyQuantityChange(item, action === "take" ? -qty : qty);

    // 盒子端明細（相同品項合併數量）
    const nextHeld = action === "take" ? held + qty : held - qty;
    if (index >= 0) {
      if (nextHeld === 0) entries.splice(index, 1);
      else entries[index].quantity = nextHeld;
    } else {
      entries.push({ itemId, name: item.name || "", category: item.category || null, unit: item.unit ?? null, quantity: nextHeld });
    }

    transaction.update(itemRef, { quantity: result.quantity, status: result.status, updatedAt: sdk.serverTimestamp() });
    transaction.update(boxRef, { items: entries, updatedAt: sdk.serverTimestamp() });
    committedVersion = writeItemsVersion(transaction);
    const logRef = sdk.doc(sdk.collection(db, LOGS));
    transaction.set(logRef, buildLogPayload({
      action, source: "box", actor,
      userName: box.userName, userUid: box.userUid ?? null,
      item, quantity: qty, box,
    }));
    return { box: { ...box, items: entries }, item: { ...item, quantity: result.quantity, status: result.status } };
  });
  rememberItemsVersion(committedVersion);
  return resultValue;
}

/**
 * 一次取用多個品項到同一盒子（單一交易，全部成功或全部失敗）。
 * @param {{boxId:string, entries:Array<{itemId:string, quantity:number}>}} cfg
 */
export async function fbBoxTakeItems({ boxId, entries }) {
  await initFirebase();
  const actor = requireActor();
  // 合併重複品項的數量，並驗證輸入。
  const wanted = new Map();
  for (const entry of entries || []) {
    const qty = Number(entry.quantity);
    if (!entry.itemId) continue;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw Object.assign(new Error("數量必須是正整數"), { code: "invalid-quantity" });
    }
    wanted.set(entry.itemId, (wanted.get(entry.itemId) || 0) + qty);
  }
  if (!wanted.size) throw Object.assign(new Error("請至少選擇一個品項"), { code: "invalid-quantity" });

  const boxRef = sdk.doc(db, BOXES, boxId);
  const itemRefs = new Map([...wanted.keys()].map((id) => [id, sdk.doc(db, COLLECTION, id)]));

  let committedVersion = null;
  const resultValue = await sdk.runTransaction(db, async (transaction) => {
    // 交易要求先讀後寫：一次讀盒子與所有品項。
    const boxSnap = await transaction.get(boxRef);
    if (!boxSnap.exists()) throw Object.assign(new Error("找不到盒子"), { code: "not-found" });
    const box = { ...boxSnap.data(), id: boxId };
    if (box.status === "closed") throw Object.assign(new Error("此盒子已結束，無法再操作"), { code: "box-closed" });

    const itemSnaps = new Map();
    for (const [id, ref] of itemRefs) itemSnaps.set(id, await transaction.get(ref));

    const entriesOut = Array.isArray(box.items) ? box.items.map((entry) => ({ ...entry })) : [];
    const applied = [];
    for (const [id, qty] of wanted) {
      const snap = itemSnaps.get(id);
      if (!snap.exists()) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
      const item = { ...snap.data(), id };
      if (item.category === "tool" && !isToolTakable(item)) {
        throw Object.assign(new Error(`「${item.name}」為特殊狀態，無法取用`), { code: "special-status" });
      }
      let result;
      try {
        result = applyQuantityChange(item, -qty); // 邊界與工具狀態統一處理
      } catch (err) {
        if (err.code === "insufficient") {
          const avail = Math.max(0, Number(item.quantity) || 0);
          throw Object.assign(new Error(`「${item.name}」可用數量不足（需 ${qty}，剩 ${avail}）`), { code: "insufficient" });
        }
        throw err;
      }
      const index = entriesOut.findIndex((entry) => entry.itemId === id);
      const held = index >= 0 ? Math.max(0, Number(entriesOut[index].quantity) || 0) : 0;
      if (index >= 0) entriesOut[index].quantity = held + qty;
      else entriesOut.push({ itemId: id, name: item.name || "", category: item.category || null, unit: item.unit ?? null, quantity: held + qty });
      applied.push({ item, qty, result });
    }

    for (const { item, result } of applied) {
      transaction.update(itemRefs.get(item.id), { quantity: result.quantity, status: result.status, updatedAt: sdk.serverTimestamp() });
    }
    transaction.update(boxRef, { items: entriesOut, updatedAt: sdk.serverTimestamp() });
    committedVersion = writeItemsVersion(transaction);
    // 每筆取用各自一筆 log。
    for (const { item, qty } of applied) {
      const logRef = sdk.doc(sdk.collection(db, LOGS));
      transaction.set(logRef, buildLogPayload({
        action: "take", source: "box", actor,
        userName: box.userName, userUid: box.userUid ?? null,
        item, quantity: qty, box,
      }));
    }
    return { box: { ...box, items: entriesOut } };
  });
  rememberItemsVersion(committedVersion);
  return resultValue;
}

/** 標記盒子已結束（僅限已無未歸還品項）。 */
export async function fbCloseUsageBox(boxId) {
  await initFirebase();
  requireActor();
  const ref = sdk.doc(db, BOXES, boxId);
  return sdk.runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw Object.assign(new Error("找不到盒子"), { code: "not-found" });
    const box = snap.data();
    if ((box.items || []).length > 0) {
      throw Object.assign(new Error("盒內仍有未歸還品項，無法標記結束"), { code: "box-not-empty" });
    }
    transaction.update(ref, { status: "closed", updatedAt: sdk.serverTimestamp() });
    return true;
  });
}

/** 刪除盒子（僅限空盒；歷史 log 不受影響）。 */
export async function fbDeleteUsageBox(boxId) {
  await initFirebase();
  requireActor();
  const ref = sdk.doc(db, BOXES, boxId);
  return sdk.runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return true;
    if ((snap.data().items || []).length > 0) {
      throw Object.assign(new Error("盒內仍有品項，只能刪除空盒子"), { code: "box-not-empty" });
    }
    transaction.delete(ref);
    return true;
  });
}

/* ================= prepOrders ================= */

export async function fbGetPrepOrders() {
  await initFirebase();
  logFirestoreRead(PREP, "備料單");
  const snap = await sdk.getDocs(sdk.collection(db, PREP));
  return snap.docs.map(mapDoc);
}

function sanitizeLines(lines) {
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
  await initFirebase();
  const actor = requireActor();
  const payload = {
    name: String(name || "").trim(),
    createdByUid: actor.uid,
    createdByName: actor.name || "",
    status: "draft",
    lines: sanitizeLines(lines),
    preparedAt: null,
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  };
  const ref = await sdk.addDoc(sdk.collection(db, PREP), payload);
  return { ...payload, id: ref.id };
}

export async function fbUpdatePrepOrder(orderId, { name, lines }) {
  await initFirebase();
  requireActor();
  const ref = sdk.doc(db, PREP, orderId);
  return sdk.runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw Object.assign(new Error("找不到備料單"), { code: "not-found" });
    if (snap.data().status !== "draft") {
      throw Object.assign(new Error("已備料的備料單無法編輯"), { code: "order-not-draft" });
    }
    transaction.update(ref, {
      name: String(name || "").trim(),
      lines: sanitizeLines(lines),
      updatedAt: sdk.serverTimestamp(),
    });
    return true;
  });
}

/**
 * 完成備料。單一交易：重新讀取所有要扣庫存的材料並驗證，
 * 任一不足 → 整筆取消（丟出含不足清單的錯誤）；全部足夠 → 扣庫存、
 * 更新備料單狀態與實際扣除數量、每個扣庫存品項各寫一筆 log。
 */
export async function fbExecutePrepOrder(orderId) {
  await initFirebase();
  const actor = requireActor();
  const orderRef = sdk.doc(db, PREP, orderId);

  let committedVersion = null;
  const resultValue = await sdk.runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw Object.assign(new Error("找不到備料單"), { code: "not-found" });
    const order = { ...orderSnap.data(), id: orderId };
    if (order.status !== "draft") {
      throw Object.assign(new Error("此備料單已完成備料，不可重複取料"), { code: "order-not-draft" });
    }

    const lines = (order.lines || []).map((line) => ({ ...line }));
    const deductLines = lines.filter((line) => line.deduct && line.itemId);

    // 交易內全部先讀（Firestore 交易要求先讀後寫）
    const itemSnaps = new Map();
    for (const line of deductLines) {
      if (!itemSnaps.has(line.itemId)) {
        itemSnaps.set(line.itemId, await transaction.get(sdk.doc(db, COLLECTION, line.itemId)));
      }
    }

    // 驗證全部庫存；蒐集不足清單
    const shortages = [];
    const plans = new Map(); // itemId -> { item, nextQuantity }
    for (const line of deductLines) {
      const snap = itemSnaps.get(line.itemId);
      if (!snap.exists()) { shortages.push(`${line.name}（品項已不存在）`); continue; }
      const item = { ...snap.data(), id: line.itemId };
      if (item.category !== "material") { shortages.push(`${line.name}（非材料，無法扣庫存）`); continue; }
      const already = plans.get(line.itemId)?.nextQuantity ?? Math.max(0, Number(item.quantity) || 0);
      const next = already - line.quantity;
      if (next < 0) {
        shortages.push(`${line.name}（需 ${line.quantity}，剩 ${already}）`);
        continue;
      }
      plans.set(line.itemId, { item, nextQuantity: next });
    }
    if (shortages.length) {
      throw Object.assign(
        new Error(`庫存不足，整筆取消：${shortages.join("、")}`),
        { code: "insufficient", shortages },
      );
    }

    // 寫入：扣庫存
    for (const [itemId, plan] of plans) {
      transaction.update(sdk.doc(db, COLLECTION, itemId), {
        quantity: plan.nextQuantity,
        updatedAt: sdk.serverTimestamp(),
      });
    }
    if (plans.size) committedVersion = writeItemsVersion(transaction);
    // 寫入：明細實際扣除數量 + 單狀態
    for (const line of lines) {
      if (line.deduct && line.itemId) line.executedQuantity = line.quantity;
    }
    transaction.update(orderRef, {
      status: "prepared",
      lines,
      preparedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
    // 寫入：每個扣庫存品項一筆 log
    for (const line of deductLines) {
      const plan = plans.get(line.itemId);
      const logRef = sdk.doc(sdk.collection(db, LOGS));
      transaction.set(logRef, buildLogPayload({
        action: "take", source: "prep", actor,
        item: plan.item, quantity: line.quantity,
        prepOrder: order,
      }));
    }
    return { ...order, status: "prepared", lines };
  });
  if (committedVersion) rememberItemsVersion(committedVersion);
  return resultValue;
}

/** 刪除備料單（不回補庫存、不刪 log）。 */
export async function fbDeletePrepOrder(orderId) {
  await initFirebase();
  requireActor();
  await sdk.deleteDoc(sdk.doc(db, PREP, orderId));
  return true;
}

/* ================= activityLogs ================= */

/**
 * 讀取最新 log（單一欄位 orderBy + limit，不需要 composite index）。
 * 關鍵字／動作／日期等篩選由前端在載入結果上執行。
 */
export async function fbGetLogs({ max = 500 } = {}) {
  await initFirebase();
  logFirestoreRead(LOGS, `最新 ${max} 筆 Log`);
  const q = sdk.query(sdk.collection(db, LOGS), sdk.orderBy("at", "desc"), sdk.limit(max));
  const snap = await sdk.getDocs(q);
  return snap.docs.map(mapDoc);
}

/** 管理員清空所有 Log。分批處理以遵守 Firestore 每批寫入上限。 */
export async function fbClearLogs() {
  await initFirebase();
  requireActor();
  let deleted = 0;
  while (true) {
    logFirestoreRead(LOGS, "清空前讀取待刪除批次");
    const q = sdk.query(sdk.collection(db, LOGS), sdk.limit(400));
    const snap = await sdk.getDocs(q);
    if (snap.empty) break;
    const batch = sdk.writeBatch(db);
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}
