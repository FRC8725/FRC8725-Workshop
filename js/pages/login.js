import { authErrorMessage, loginWithGoogle, logoutUser } from "../services/auth-service.js";

export function mountLoginPage({ user = null, pending = false, error = "" } = {}) {
  const button = document.getElementById("google-login-button");
  const logoutButton = document.getElementById("logout-button");
  const status = document.getElementById("login-status");
  const errorHost = document.getElementById("login-error");
  const accountHost = document.getElementById("login-account");
  let busy = false;

  const showError = (message = "") => {
    errorHost.textContent = message;
    errorHost.hidden = !message;
  };
  showError(error);
  if (user) {
    status.textContent = pending ? "授權申請已送出，請等待管理員審核。" : "此帳號尚未取得系統使用權限。";
    accountHost.textContent = `目前登入：${user.email || "未知 Email"}`;
    accountHost.hidden = false;
    button.textContent = "切換 Google 帳號";
    logoutButton.hidden = false;
  }

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    showError();
    status.textContent = "正在開啟 Google 登入…";
    try { await loginWithGoogle(); }
    catch (authError) {
      showError(authErrorMessage(authError));
      status.textContent = "登入未完成。";
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  logoutButton.addEventListener("click", () => logoutUser());
}
