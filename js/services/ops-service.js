// js/services/ops-service.js — 作業（盒子／備料單）與 activityLogs 的資料入口。
//
// 頁面一律透過這裡操作，不直接碰 Firebase。與 data-service.js 相同的
// backend 切換方式：?demo=1 → demo-service（localStorage），否則 firebase-service。

import { getCurrentUser } from "./auth-service.js";
import { isDemoMode } from "../core/demo-mode.js";
import { invalidateItemCache } from "./data-service.js";

let backendModule = null;

async function backend() {
  if (isDemoMode()) {
    if (!backendModule) backendModule = await import("./demo-service.js");
    return backendModule;
  }
  if (!getCurrentUser()) throw Object.assign(new Error("登入狀態已失效，請重新登入。"), { code: "unauthenticated" });
  if (!backendModule) backendModule = await import("./firebase-service.js");
  return backendModule;
}

/* ---------------- 盒子 ---------------- */

export async function getUsageBoxes() {
  return (await backend()).fbGetUsageBoxes();
}

export async function createUsageBox(box) {
  return (await backend()).fbCreateUsageBox(box);
}

/** 取用：action "take"；歸還：action "return"。原子操作，含庫存與 log。 */
export async function boxTransferItem(cfg) {
  const result = await (await backend()).fbBoxTransferItem(cfg);
  if (!isDemoMode()) invalidateItemCache();
  return result;
}

/** 一次取用多個品項到同一盒子（單一原子操作，全部成功或全部失敗）。 */
export async function boxTakeItems(cfg) {
  const result = await (await backend()).fbBoxTakeItems(cfg);
  if (!isDemoMode()) invalidateItemCache();
  return result;
}

export async function closeUsageBox(boxId) {
  return (await backend()).fbCloseUsageBox(boxId);
}

export async function deleteUsageBox(boxId) {
  return (await backend()).fbDeleteUsageBox(boxId);
}

/* ---------------- 備料單 ---------------- */

export async function getPrepOrders() {
  return (await backend()).fbGetPrepOrders();
}

export async function createPrepOrder(order) {
  return (await backend()).fbCreatePrepOrder(order);
}

export async function updatePrepOrder(orderId, updates) {
  return (await backend()).fbUpdatePrepOrder(orderId, updates);
}

/** 取料／完成備料：原子扣庫存 + 寫 log；不足時整筆取消（err.shortages）。 */
export async function executePrepOrder(orderId) {
  const result = await (await backend()).fbExecutePrepOrder(orderId);
  if (!isDemoMode()) invalidateItemCache();
  return result;
}

export async function deletePrepOrder(orderId) {
  return (await backend()).fbDeletePrepOrder(orderId);
}

/* ---------------- logs（僅 admin 頁面使用） ---------------- */

export async function getActivityLogs(options) {
  return (await backend()).fbGetLogs(options);
}

export async function clearActivityLogs() {
  return (await backend()).fbClearLogs();
}
