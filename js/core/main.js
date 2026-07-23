import { checkCurrentUserAuthorization, observeAuthState } from "../services/auth-service.js";
import { clearProtectedUi, initChrome, resetChrome } from "./app.js";
import { submitPendingRequest } from "../services/user-service.js";
import { mountLoginPage } from "../pages/login.js";
import { startRouter, stopRouter } from "./router.js";
import { initSidebarToggle } from "../ui/sidebar.js";
import { isDemoMode, buildDemoSession } from "./demo-mode.js";

initSidebarToggle();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((error) => {
      console.warn("Service worker 註冊失敗：", error);
    });
  });
}

const outlet = document.getElementById("page-outlet");
let authRevision = 0;

async function showLogin(user = null, pending = false, error = "") {
  stopRouter();
  resetChrome();
  const response = await fetch("pages/login.html");
  outlet.innerHTML = await response.text();
  mountLoginPage({ user, pending, error });
}

async function handleAuth(user) {
  const revision = ++authRevision;
  if (!user) {
    clearProtectedUi();
    await showLogin();
    return;
  }
  outlet.innerHTML = '<div class="state-block"><div class="spinner"></div>正在確認帳號權限…</div>';
  try {
    const authorization = await checkCurrentUserAuthorization();
    if (revision !== authRevision) return;
    if (!authorization.authorized) {
      await submitPendingRequest(user);
      await showLogin(user, true);
      return;
    }
    const session = { user, ...authorization };
    initChrome(session);
    startRouter(session);
    maybeExposeItemIdMigration();
  } catch (error) {
    console.error(error);
    await showLogin(user, false, "無法確認或建立授權資料，請稍後再試。");
  }
}

// 一次性工具：以 ?migrate-item-ids=1 開啟網站後，於主控台手動執行
// window.migrateLegacyItemIds() 將舊版 item-<uuid> 物品 id 轉回 Firestore 原生格式。
// 只掛載函式、不自動執行，避免誤觸；建議先以 { dryRun: true } 預覽。
function maybeExposeItemIdMigration() {
  try {
    if (new URLSearchParams(location.search).get("migrate-item-ids") !== "1") return;
  } catch { return; }
  import("../services/migrate-item-ids.js").then((m) => {
    window.migrateLegacyItemIds = m.migrateLegacyItemIds;
    console.log(
      "[migrate] 已就緒。先執行 `await migrateLegacyItemIds({ dryRun: true })` 預覽，" +
      "確認後再執行 `await migrateLegacyItemIds()`。",
    );
  }).catch((error) => console.error("[migrate] 載入失敗：", error));
}

if (isDemoMode()) {
  const session = buildDemoSession();
  initChrome(session);
  startRouter(session);
} else {
  observeAuthState(handleAuth).catch((error) => showLogin(null, false, error.message));
}
