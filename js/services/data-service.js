// Firestore-only data service. localStorage is used only by UI view preferences elsewhere.

import { loadJSON } from "../utils/utils.js";
import { getCurrentUser } from "./auth-service.js";

const MAP_PATH = "config/workshop-map.json";
const STRUCT_PATH = "config/storage-structures.json";
const SUMMARY_PATH = "config/summary-stats.json";
let fb = null;
let memCache = null;
let configCache = { map: null, structures: null, summaryStats: null };

async function firebase() {
  if (!getCurrentUser()) throw Object.assign(new Error("登入狀態已失效，請重新登入。"), { code: "unauthenticated" });
  if (!fb) fb = await import("./firebase-service.js");
  return fb;
}

export function clearDataCache() {
  memCache = null;
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

export async function getStructureById(structureId) {
  return (await getStructures()).find((structure) => structure.id === structureId) || null;
}

export async function getAreaById(areaId) {
  const map = await getWorkshopMap();
  return (map.areas || []).find((area) => area.id === areaId) || null;
}

export async function getItems() {
  const svc = await firebase();
  memCache = await svc.fbGetItems();
  return memCache;
}

export async function getItemsByStorageId(storageId) {
  return (await getItems()).filter((item) => item.storageId === storageId);
}

export async function getItemById(itemId) {
  return (await firebase()).fbGetItemById(itemId);
}

export async function createItem(itemData) {
  const created = await (await firebase()).fbCreateItem(itemData);
  if (memCache) memCache.push(created);
  return created;
}

export async function updateItem(itemId, updates) {
  const result = await (await firebase()).fbUpdateItem(itemId, updates);
  if (memCache) {
    const index = memCache.findIndex((item) => item.id === itemId);
    if (index >= 0) memCache[index] = { ...memCache[index], ...updates };
  }
  return result;
}

export async function deleteItem(itemId) {
  await (await firebase()).fbDeleteItem(itemId);
  if (memCache) memCache = memCache.filter((item) => item.id !== itemId);
  return true;
}

export async function searchItems(query, filterFn) {
  const items = await getItems();
  return typeof filterFn === "function" ? filterFn(items, query) : items;
}
