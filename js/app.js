// js/app.js — shared chrome: nav state, data-mode banner, reset demo data

import { getMode, isDemoMode, resetDemoData, getFallbackReason } from "./data-service.js";
import { isFirebaseConfigured } from "./firebase-config.js";
import { confirmModal } from "./modal.js";
import { notify } from "./notifications.js";
import { icon } from "./utils.js";

/** Highlight the active nav link based on current filename. */
export function markActiveNav() {
  const file = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach((link) => {
    const target = link.getAttribute("data-page");
    if (!target) return;
    link.classList.toggle("active", target === file);
  });
}

/**
 * Render the "using demo data" banner into a host element.
 * @param {HTMLElement} host
 */
export function renderModeBanner(host) {
  if (!host) return;
  if (!isDemoMode()) {
    host.innerHTML = "";
    return;
  }
  const reason = getFallbackReason();
  const msg = reason === "firebase-error"
    ? "無法連線 Firebase，目前使用示範資料（儲存在此瀏覽器的 localStorage）。"
    : "Firebase 尚未設定，目前使用示範資料。所有變更會儲存在此瀏覽器的 localStorage。";
  host.innerHTML = `
    <div class="banner ${reason === "firebase-error" ? "banner-danger" : "banner-warning"}">
      <span style="display:inline-flex">${icon("info", { size: "16px" })}</span>
      <span>${msg}</span>
      <span class="banner-actions">
        <button class="btn btn-sm btn-ghost" id="reset-demo-btn">重設示範資料</button>
      </span>
    </div>
  `;
  const btn = host.querySelector("#reset-demo-btn");
  if (btn) btn.addEventListener("click", () => handleResetDemo());
}

/** Confirm + reset demo data, then reload. */
export async function handleResetDemo() {
  const ok = await confirmModal({
    title: "重設示範資料",
    message: "確定要清除目前的變更，並還原為內建示範資料嗎？",
    detail: "此動作會覆寫你在示範模式中所做的所有新增、修改與刪除。",
    confirmText: "重設",
    danger: true,
  });
  if (!ok) return;
  try {
    await resetDemoData();
    notify.success("已重設為示範資料");
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    notify.danger("重設失敗：" + (err.message || "未知錯誤"));
  }
}

/** Wire a "reset demo data" trigger (e.g. settings nav link). */
export function wireResetTrigger(selector) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.addEventListener("click", (e) => {
    e.preventDefault();
    if (isDemoMode()) handleResetDemo();
    else notify.info("目前使用 Firebase，重設示範資料僅在示範模式可用。");
  });
}

/** Common bootstrap shared by all pages. */
export function initChrome() {
  markActiveNav();
  wireResetTrigger('[data-action="reset-demo"]');
  if (isFirebaseConfigured()) {
    console.info("Firebase 已設定，資料模式：", getMode());
  } else {
    console.info("Firebase 未設定，使用示範資料模式。");
  }
}
