// js/firebase-service.js
//
// 封裝所有 Firestore 操作。此檔案「只」在 Firebase 已設定時才會被載入使用。
// 其他頁面不應直接呼叫這裡的函式 —— 請透過 data-service.js。

import { firebaseConfig, FIREBASE_SDK_VERSION } from "./firebase-config.js";

const V = FIREBASE_SDK_VERSION;
const COLLECTION = "items";

let db = null;
let sdk = null;

/** 初始化 Firebase App 與 Firestore（動態載入 CDN 模組）。 */
export async function initFirebase() {
  if (db) return db;

  const appMod = await import(
    `https://www.gstatic.com/firebasejs/${V}/firebase-app.js`
  );
  const fsMod = await import(
    `https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`
  );

  const app = appMod.initializeApp(firebaseConfig);
  db = fsMod.getFirestore(app);
  sdk = fsMod;
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

export async function fbDeleteItem(itemId) {
  await initFirebase();
  await sdk.deleteDoc(sdk.doc(db, COLLECTION, itemId));
  return true;
}
