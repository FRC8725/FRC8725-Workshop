// js/data-service.js
//
// 資料存取抽象層。頁面只透過這裡讀寫資料，
// 由這裡自動決定使用 Firebase Firestore、還是 localStorage 示範模式。

import { isFirebaseConfigured } from "./firebase-config.js";
import { loadJSON, generateId } from "./utils.js";

const LS_KEY = "workshop-manager-items";
const DEMO_PATH = "data/demo-items.json";
const MAP_PATH = "config/workshop-map.json";
const STRUCT_PATH = "config/storage-structures.json";

// mode: "firebase" | "demo"
let mode = isFirebaseConfigured() ? "firebase" : "demo";
let fb = null; // lazily loaded firebase-service module
let memCache = null; // in-memory item cache (used to build search & summaries)

let configCache = { map: null, structures: null };

export function getMode() {
  return mode;
}

export function isDemoMode() {
  return mode === "demo";
}

/** Lazily import the Firebase service only when needed. */
async function firebase() {
  if (!fb) fb = await import("./firebase-service.js");
  return fb;
}

/* ---------------- localStorage helpers ---------------- */

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLS(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn("localStorage 寫入失敗", err);
  }
}

/** Load demo items into localStorage the first time. */
async function ensureDemoSeed() {
  let items = readLS();
  if (!items) {
    items = await loadJSON(DEMO_PATH);
    const now = new Date().toISOString();
    items = items.map((it) => ({ createdAt: now, updatedAt: now, ...it }));
    writeLS(items);
  }
  return items;
}

/** Reset localStorage back to the bundled demo data. */
export async function resetDemoData() {
  localStorage.removeItem(LS_KEY);
  memCache = null;
  const items = await ensureDemoSeed();
  memCache = items;
  return items;
}

/* ---------------- Config loaders ---------------- */

export async function getWorkshopMap() {
  if (!configCache.map) configCache.map = await loadJSON(MAP_PATH);
  return configCache.map;
}

export async function getStructures() {
  if (!configCache.structures) {
    const data = await loadJSON(STRUCT_PATH);
    configCache.structures = data.structures || [];
  }
  return configCache.structures;
}

export async function getStructureById(structureId) {
  const list = await getStructures();
  return list.find((s) => s.id === structureId) || null;
}

export async function getAreaById(areaId) {
  const map = await getWorkshopMap();
  return (map.areas || []).find((a) => a.id === areaId) || null;
}

/* ---------------- CRUD (mode-aware) ---------------- */

export async function getItems() {
  if (mode === "firebase") {
    try {
      const svc = await firebase();
      memCache = await svc.fbGetItems();
      return memCache;
    } catch (err) {
      console.error("Firebase 讀取失敗，改用示範資料。", err);
      mode = "demo";
      _fallbackReason = "firebase-error";
    }
  }
  memCache = await ensureDemoSeed();
  return memCache;
}

export async function getItemsByStorageId(storageId) {
  const items = await getItems();
  return items.filter((it) => it.storageId === storageId);
}

export async function getItemById(itemId) {
  if (mode === "firebase") {
    const svc = await firebase();
    return svc.fbGetItemById(itemId);
  }
  const items = await ensureDemoSeed();
  return items.find((it) => it.id === itemId) || null;
}

export async function createItem(itemData) {
  const now = new Date().toISOString();
  if (mode === "firebase") {
    const svc = await firebase();
    const created = await svc.fbCreateItem(itemData);
    if (memCache) memCache.push(created);
    return created;
  }
  const items = await ensureDemoSeed();
  const created = { ...itemData, id: generateId("item"), createdAt: now, updatedAt: now };
  items.push(created);
  writeLS(items);
  memCache = items;
  return created;
}

export async function updateItem(itemId, updates) {
  const now = new Date().toISOString();
  if (mode === "firebase") {
    const svc = await firebase();
    const res = await svc.fbUpdateItem(itemId, updates);
    if (memCache) {
      const i = memCache.findIndex((it) => it.id === itemId);
      if (i >= 0) memCache[i] = { ...memCache[i], ...updates };
    }
    return res;
  }
  const items = await ensureDemoSeed();
  const i = items.findIndex((it) => it.id === itemId);
  if (i < 0) throw new Error("找不到要更新的物品");
  items[i] = { ...items[i], ...updates, updatedAt: now };
  writeLS(items);
  memCache = items;
  return items[i];
}

export async function deleteItem(itemId) {
  if (mode === "firebase") {
    const svc = await firebase();
    await svc.fbDeleteItem(itemId);
    if (memCache) memCache = memCache.filter((it) => it.id !== itemId);
    return true;
  }
  const items = await ensureDemoSeed();
  const next = items.filter((it) => it.id !== itemId);
  writeLS(next);
  memCache = next;
  return true;
}

/** Whole-collection search (front-end). Delegates to search.js filter. */
export async function searchItems(query, filterFn) {
  const items = await getItems();
  if (typeof filterFn === "function") return filterFn(items, query);
  return items;
}

let _fallbackReason = null;
export function getFallbackReason() {
  return _fallbackReason;
}
