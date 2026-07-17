// js/firebase-service.js
//
// 封裝所有 Firestore 操作。此檔案「只」在 Firebase 已設定時才會被載入使用。
// 其他頁面不應直接呼叫這裡的函式 —— 請透過 data-service.js。

import { getFirebaseDb } from "../core/firebase-client.js";

const COLLECTION = "items";

let db = null;
let sdk = null;

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

export async function fbGetItems() {
  await initFirebase();
  const snap = await sdk.getDocs(sdk.collection(db, COLLECTION));
  return snap.docs.map(mapDoc);
}

export async function fbGetItemById(itemId) {
  await initFirebase();
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
  const ref = await sdk.addDoc(sdk.collection(db, COLLECTION), payload);
  return { ...itemData, id: ref.id };
}

export async function fbUpdateItem(itemId, updates) {
  await initFirebase();
  const ref = sdk.doc(db, COLLECTION, itemId);
  const payload = { ...updates, updatedAt: sdk.serverTimestamp() };
  delete payload.id;
  await sdk.updateDoc(ref, payload);
  return { ...updates, id: itemId };
}

/** Atomically adjust quantity so concurrent devices cannot overwrite each other. */
export async function fbAdjustItemQuantity(itemId, delta) {
  await initFirebase();
  if (delta !== 1 && delta !== -1) throw new Error("數量調整值必須是 1 或 -1");
  const ref = sdk.doc(db, COLLECTION, itemId);
  return sdk.runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw Object.assign(new Error("找不到物品"), { code: "not-found" });
    const item = snap.data() || {};
    const current = Math.max(0, Number(item.quantity) || 0);
    const total = Math.max(0, Number(item.totalQuantity ?? item.quantity) || 0);
    const quantity = item.category === "tool"
      ? Math.min(total, Math.max(0, current + delta))
      : Math.max(0, current + delta);
    if (quantity === current) {
      const code = delta < 0 ? "quantity-empty" : "quantity-full";
      throw Object.assign(new Error(delta < 0 ? "數量已經是 0" : "工具已全部歸還"), { code });
    }
    transaction.update(ref, { quantity, updatedAt: sdk.serverTimestamp() });
    return { ...item, id: itemId, quantity };
  });
}

export async function fbDeleteItem(itemId) {
  await initFirebase();
  await sdk.deleteDoc(sdk.doc(db, COLLECTION, itemId));
  return true;
}
