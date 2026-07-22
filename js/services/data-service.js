// Data service. Backed by Firestore normally; backed by localStorage when
// ?demo=1 is active (see js/core/demo-mode.js and js/services/demo-service.js).
// Firestore inventory is cached per signed-in UID. At app startup we read one
// lightweight version document; the full items collection is fetched only when
// that version differs from the local snapshot.

import { loadJSON } from "../utils/utils.js";
import { getCurrentUser } from "./auth-service.js";
import { isDemoMode } from "../core/demo-mode.js";
import { debugLog } from "../core/debug-mode.js";
import { applyQuantityChange } from "../utils/item-logic.js";

const MAP_PATH = "config/maps/workshop-map.json";
const STRUCT_PATH = "config/storage-structures.json";
const SUMMARY_PATH = "config/summary-stats.json";
const PLANS_PATH = "config/floor-plans.json";
let fb = null;
let memCache = null;
let memCacheVersion = "";
let memCacheValidatedAt = 0;
const CACHE_REVALIDATE_MS = 5 * 60 * 1000;
let configCache = { map: null, structures: null, summaryStats: null, plans: null, allAreas: null };
const mapFileCache = new Map(); // path -> parsed map JSON

async function backend() {
  if (isDemoMode()) {
    if (!fb) fb = await import("./demo-service.js");
    return fb;
  }
  if (!getCurrentUser()) throw Object.assign(new Error("登入狀態已失效，請重新登入。"), { code: "unauthenticated" });
  if (!fb) fb = await import("./firebase-service.js");
  return fb;
}

export function clearDataCache() {
  memCache = null;
  memCacheVersion = "";
  memCacheValidatedAt = 0;
}

function isRecentlyValidated(value) {
  const ms = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(ms) && Date.now() - ms < CACHE_REVALIDATE_MS;
}

function logCacheRead(target, detail = "") {
  debugLog(`[快取讀取] ${target}${detail ? `｜${detail}` : ""}`);
}

function nextLocalVersionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextLocalItemId() {
  if (globalThis.crypto?.randomUUID) return `item-${globalThis.crypto.randomUUID()}`;
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function itemCacheKey() {
  const uid = getCurrentUser()?.uid;
  // v2 invalidates snapshots created before mutation-aware cache handling.
  return uid ? `workshop.firestore.items.v2.${uid}` : "";
}

function itemSegmentKey(storageId) {
  const uid = getCurrentUser()?.uid;
  return uid && storageId
    ? `workshop.firestore.items-segment.v2.${uid}.${encodeURIComponent(storageId)}`
    : "";
}

function readSegmentCache(storageId) {
  const key = itemSegmentKey(storageId);
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed.version === "string" && parsed.version.length > 0 && Array.isArray(parsed.items) ? parsed : null;
  } catch { return null; }
}

function writeSegmentCache(storageId, version, items) {
  const key = itemSegmentKey(storageId);
  if (!key || !version) return;
  try {
    localStorage.setItem(key, JSON.stringify({ version, items, validatedAt: new Date().toISOString() }));
  } catch (error) { console.warn("無法儲存儲位分段快取。", error); }
}

function removeFullItemCache() {
  const key = itemCacheKey();
  if (key) try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function readItemCache() {
  const key = itemCacheKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed.version === "string" && parsed.version.length > 0 && Array.isArray(parsed.items) ? parsed : null;
  } catch { return null; }
}

function writeItemCache(version, items) {
  const key = itemCacheKey();
  if (!key || !version || !Array.isArray(items)) return;
  try {
    localStorage.setItem(key, JSON.stringify({ version, items, validatedAt: new Date().toISOString() }));
  } catch (error) {
    console.warn("無法儲存本機庫存快取。", error);
  }
}

/** 作業交易改變庫存後，強制下一次 getItems 下載新版本。 */
export function invalidateItemCache() {
  memCache = null;
  memCacheVersion = "";
  memCacheValidatedAt = 0;
  removeFullItemCache();
}

function applyOptimisticItemChange(version, storageIds, transform) {
  const fullKey = itemCacheKey();
  const segmentKeys = [...new Set(storageIds.filter(Boolean))].map(itemSegmentKey).filter(Boolean);
  const previous = new Map();
  for (const key of [fullKey, ...segmentKeys].filter(Boolean)) {
    try { previous.set(key, localStorage.getItem(key)); } catch { previous.set(key, null); }
  }
  const previousMemCache = memCache ? [...memCache] : null;
  const previousMemVersion = memCacheVersion;
  const previousValidatedAt = memCacheValidatedAt;

  if (memCache) memCache = transform(memCache, null);
  const full = readItemCache();
  if (full) writeItemCache(version, transform(full.items, null));
  else if (memCache) writeItemCache(version, memCache);
  for (const storageId of new Set(storageIds.filter(Boolean))) {
    const segment = readSegmentCache(storageId);
    if (segment) {
      writeSegmentCache(storageId, version,
        transform(segment.items, storageId).filter((item) => item.storageId === storageId));
    }
  }
  memCacheVersion = version;
  memCacheValidatedAt = Date.now();

  return () => {
    memCache = previousMemCache;
    memCacheVersion = previousMemVersion;
    memCacheValidatedAt = previousValidatedAt;
    for (const [key, raw] of previous) {
      try { raw == null ? localStorage.removeItem(key) : localStorage.setItem(key, raw); } catch { /* ignore */ }
    }
  };
}

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

export async function getSummaryStatsConfig() {
  if (!configCache.summaryStats) {
    const data = await loadJSON(SUMMARY_PATH);
    configCache.summaryStats = Array.isArray(data.stats) ? data.stats : [];
  }
  return configCache.summaryStats;
}

/** 多平面圖清單。若未設定 floor-plans.json，退回單一預設平面圖。 */
export async function getFloorPlans() {
  if (!configCache.plans) {
    let plans = [];
    try {
      const data = await loadJSON(PLANS_PATH);
      plans = Array.isArray(data.plans) ? data.plans.filter((plan) => plan && plan.id) : [];
    } catch { plans = []; }
    if (!plans.length) {
      const map = await getWorkshopMap();
      plans = [{ id: "main", name: "培訓室平面圖", image: map.mapImage, aspectRatio: map.aspectRatio, map: MAP_PATH }];
    }
    configCache.plans = plans;
  }
  return configCache.plans;
}

async function loadMapFile(path) {
  const key = path || MAP_PATH;
  if (key === MAP_PATH) return getWorkshopMap();
  if (!mapFileCache.has(key)) mapFileCache.set(key, await loadJSON(key));
  return mapFileCache.get(key);
}

/** 取得單一平面圖的影像與其區域。 */
export async function getFloorPlanData(plan) {
  const map = await loadMapFile(plan?.map);
  return {
    image: plan?.image || map.mapImage,
    aspectRatio: plan?.aspectRatio || map.aspectRatio,
    areas: map.areas || [],
  };
}

/** 所有平面圖區域的聯集（依 id 去重），供位置索引與 getAreaById 使用。 */
export async function getAllAreas() {
  if (!configCache.allAreas) {
    const plans = await getFloorPlans();
    const byId = new Map();
    for (const plan of plans) {
      const map = await loadMapFile(plan.map);
      for (const area of map.areas || []) if (!byId.has(area.id)) byId.set(area.id, area);
    }
    configCache.allAreas = [...byId.values()];
  }
  return configCache.allAreas;
}

export async function getStructureById(structureId) {
  return (await getStructures()).find((structure) => structure.id === structureId) || null;
}

export async function getAreaById(areaId) {
  return (await getAllAreas()).find((area) => area.id === areaId) || null;
}

export async function getItems() {
  const svc = await backend();
  if (isDemoMode()) {
    memCache = await svc.fbGetItems();
    logCacheRead("items", "Demo localStorage");
    return memCache;
  }
  if (memCache && isRecentlyValidated(memCacheValidatedAt)) {
    logCacheRead("items", "記憶體快取（5 分鐘內）");
    return memCache;
  }

  const local = readItemCache();
  if (local && isRecentlyValidated(local.validatedAt || local.cachedAt)) {
    memCache = local.items;
    memCacheVersion = local.version;
    memCacheValidatedAt = Date.parse(local.validatedAt || local.cachedAt);
    logCacheRead("items", "localStorage 快取（5 分鐘內）");
    return memCache;
  }
  let remoteVersion;
  try {
    remoteVersion = await svc.fbGetItemsVersion();
  } catch (error) {
    // 無法確認版本就視為需要更新，不使用可能過期的本機快取。
    console.warn("無法讀取庫存版本，改用完整資料更新。", error);
    memCache = await svc.fbGetItems();
    return memCache;
  }
  if (remoteVersion && local?.version === remoteVersion) {
    memCache = local.items;
    memCacheVersion = remoteVersion;
    memCacheValidatedAt = Date.now();
    writeItemCache(remoteVersion, memCache);
    logCacheRead("items", "本機版本與 Firestore 相同");
    return memCache;
  }

  // 舊專案尚無版本時先建立基準，再讀完整資料；避免讀完後才寫版本造成併發誤標。
  if (!remoteVersion) remoteVersion = await svc.fbEnsureItemsVersion();
  memCache = await svc.fbGetItems();
  memCacheVersion = remoteVersion;
  memCacheValidatedAt = Date.now();
  writeItemCache(memCacheVersion, memCache);
  return memCache;
}

export async function getItemsByStorageId(storageId) {
  const svc = await backend();
  if (isDemoMode()) return (await svc.fbGetItems()).filter((item) => item.storageId === storageId);

  const fullLocal = readItemCache();
  const segment = readSegmentCache(storageId);
  if (fullLocal && isRecentlyValidated(fullLocal.validatedAt || fullLocal.cachedAt)) {
    logCacheRead(`items/${storageId}`, "完整 localStorage 快取（5 分鐘內）");
    return fullLocal.items.filter((item) => item.storageId === storageId);
  }
  if (segment && isRecentlyValidated(segment.validatedAt || segment.cachedAt)) {
    logCacheRead(`items/${storageId}`, "儲位分段快取（5 分鐘內）");
    return segment.items;
  }
  let version = "";
  try {
    version = await svc.fbGetItemsVersion();
  } catch (error) {
    // 版本無法讀取時視為需要更新，直接重新查詢目前儲位。
    console.warn("無法讀取儲位版本，重新下載目前儲位。", error);
    return svc.fbGetItemsByStorageId(storageId);
  }

  if (memCache && memCacheVersion === version) {
    memCacheValidatedAt = Date.now();
    logCacheRead(`items/${storageId}`, "記憶體版本與 Firestore 相同");
    return memCache.filter((item) => item.storageId === storageId);
  }
  if (fullLocal?.version === version) {
    writeItemCache(version, fullLocal.items);
    logCacheRead(`items/${storageId}`, "完整本機快取版本相同");
    return fullLocal.items.filter((item) => item.storageId === storageId);
  }
  if (segment?.version === version) {
    writeSegmentCache(storageId, version, segment.items);
    logCacheRead(`items/${storageId}`, "儲位分段版本與 Firestore 相同");
    return segment.items;
  }

  if (!version) version = await svc.fbEnsureItemsVersion();
  const items = await svc.fbGetItemsByStorageId(storageId);
  writeSegmentCache(storageId, version, items);
  return items;
}

export async function getItemById(itemId) {
  return (await backend()).fbGetItemById(itemId);
}

export async function createItem(itemData) {
  const svc = await backend();
  if (isDemoMode()) {
    const created = await svc.fbCreateItem(itemData);
    if (memCache) memCache.push(created);
    return created;
  }

  const version = nextLocalVersionId();
  const created = { ...itemData, id: nextLocalItemId() };
  const fullKey = itemCacheKey();
  const segmentKey = itemSegmentKey(created.storageId);
  const previousFullRaw = fullKey ? localStorage.getItem(fullKey) : null;
  const previousSegmentRaw = segmentKey ? localStorage.getItem(segmentKey) : null;
  const previousMemCache = memCache ? [...memCache] : null;
  const previousMemVersion = memCacheVersion;
  const previousValidatedAt = memCacheValidatedAt;

  // Local-first: update every snapshot that is already complete. Do not create
  // a segment from only the new item when that cabinet has never been loaded.
  const full = readItemCache();
  const segment = readSegmentCache(created.storageId);
  if (memCache) memCache.push(created);
  if (full && !full.items.some((item) => item.id === created.id)) {
    writeItemCache(version, [...full.items, created]);
  } else if (memCache) {
    writeItemCache(version, memCache);
  }
  if (segment && !segment.items.some((item) => item.id === created.id)) {
    writeSegmentCache(created.storageId, version, [...segment.items, created]);
  }
  memCacheVersion = version;
  memCacheValidatedAt = Date.now();

  try {
    // The same id/version is committed atomically with the Firestore document;
    // no fbGetItemsVersion or full-items read is needed after this succeeds.
    await svc.fbCreateItem(itemData, { itemId: created.id, version });
    return created;
  } catch (error) {
    memCache = previousMemCache;
    memCacheVersion = previousMemVersion;
    memCacheValidatedAt = previousValidatedAt;
    try {
      if (fullKey) previousFullRaw == null
        ? localStorage.removeItem(fullKey)
        : localStorage.setItem(fullKey, previousFullRaw);
      if (segmentKey) previousSegmentRaw == null
        ? localStorage.removeItem(segmentKey)
        : localStorage.setItem(segmentKey, previousSegmentRaw);
    } catch { /* ignore rollback storage errors */ }
    throw error;
  }
}

export async function updateItem(itemId, updates, originalItem = null) {
  const svc = await backend();
  if (isDemoMode()) return svc.fbUpdateItem(itemId, updates);
  const version = nextLocalVersionId();
  const updated = { ...(originalItem || {}), ...updates, id: itemId };
  const rollback = applyOptimisticItemChange(
    version,
    [originalItem?.storageId, updates.storageId],
    (items, segmentStorageId) => {
      const found = items.some((item) => item.id === itemId);
      const changed = items.map((item) => item.id === itemId ? { ...item, ...updates, id: itemId } : item);
      return !found && segmentStorageId === updates.storageId ? [...changed, updated] : changed;
    },
  );
  try {
    await svc.fbUpdateItem(itemId, updates, { version });
    return updated;
  } catch (error) { rollback(); throw error; }
}

export async function adjustItemQuantity(itemId, delta, originalItem = null) {
  const svc = await backend();
  if (isDemoMode() || !originalItem) {
    const result = await svc.fbAdjustItemQuantity(itemId, delta);
    if (!isDemoMode()) invalidateItemCache();
    return result;
  }
  const version = nextLocalVersionId();
  let change;
  try {
    change = applyQuantityChange(originalItem, delta);
  } catch (error) {
    if (error.code === "insufficient") {
      throw Object.assign(new Error("數量已經是 0"), { code: "quantity-empty" });
    }
    if (error.code === "over-total") {
      throw Object.assign(new Error("工具已全部歸還"), { code: "quantity-full" });
    }
    throw error;
  }
  const rollback = applyOptimisticItemChange(version, [originalItem.storageId], (items) =>
    items.map((item) => item.id === itemId ? { ...item, ...change } : item));
  try {
    return await svc.fbAdjustItemQuantity(itemId, delta, { version });
  } catch (error) { rollback(); throw error; }
}

export async function deleteItem(itemId, originalItem = null) {
  const svc = await backend();
  if (isDemoMode()) return svc.fbDeleteItem(itemId);
  const version = nextLocalVersionId();
  const rollback = applyOptimisticItemChange(version, [originalItem?.storageId],
    (items) => items.filter((item) => item.id !== itemId));
  try {
    await svc.fbDeleteItem(itemId, { version });
    return true;
  } catch (error) { rollback(); throw error; }
}

export async function searchItems(query, filterFn) {
  const items = await getItems();
  return typeof filterFn === "function" ? filterFn(items, query) : items;
}
