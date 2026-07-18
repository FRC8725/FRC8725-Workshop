import { checkCurrentUserAuthorization, observeAuthState } from "../services/auth-service.js";
import { clearProtectedUi, initChrome, resetChrome } from "./app.js";
import { submitPendingRequest } from "../services/user-service.js";
import { mountLoginPage } from "../pages/login.js";
import { startRouter, stopRouter } from "./router.js";
import { initSidebarToggle } from "../ui/sidebar.js";

initSidebarToggle();

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
  } catch (error) {
    console.error(error);
    await showLogin(user, false, "無法確認或建立授權資料，請稍後再試。");
  }
}

observeAuthState(handleAuth).catch((error) => showLogin(null, false, error.message));
