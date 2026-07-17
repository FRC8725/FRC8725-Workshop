// Shared navigation and authorized Google account chrome.

import { logoutUser } from "../services/auth-service.js";
import { clearDataCache } from "../services/data-service.js";
import { closeModal } from "../ui/modal.js";
import { renderNavigation } from "./router.js";

let activeSession = null;
let logoutHandler = null;

function avatarFallback(image, name) {
  image.hidden = true;
  const fallback = image._fallback;
  if (!fallback) return;
  fallback.textContent = (name || "U").trim().charAt(0).toUpperCase() || "U";
  fallback.hidden = false;
}

export function clearProtectedUi() {
  clearDataCache();
  closeModal();
  document.getElementById("result-list")?.replaceChildren();
  document.getElementById("structure-host")?.replaceChildren();
  activeSession = null;
}

export function resetChrome() {
  document.getElementById("account-host")?.replaceChildren();
  document.getElementById("primary-nav")?.replaceChildren();
  activeSession = null;
}

export function initChrome(session) {
  resetChrome();
  activeSession = session;
  renderNavigation();
  const accountHost = document.getElementById("account-host");
  if (!accountHost) return;

  const account = document.createElement("div");
  account.className = "nav-account";
  const image = document.createElement("img");
  image.className = "nav-avatar";
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.src = session.user.photoURL || "";
  const avatar = document.createElement("span");
  avatar.className = "nav-avatar nav-avatar-fallback";
  avatar.hidden = true;
  image._fallback = avatar;
  const displayName = session.profile?.displayName || session.user.displayName || "Google 使用者";
  image.addEventListener("error", () => avatarFallback(image, displayName));
  if (!session.user.photoURL) avatarFallback(image, displayName);

  const details = document.createElement("div");
  details.className = "nav-user-details";
  const name = document.createElement("strong");
  name.textContent = displayName;
  const email = document.createElement("span");
  email.textContent = session.user.email || "";
  const role = document.createElement("span");
  role.className = "badge badge-muted badge-plain";
  role.textContent = session.role;
  details.append(name, email, role);

  const logoutButton = document.createElement("button");
  logoutButton.className = "btn btn-sm btn-ghost";
  logoutButton.type = "button";
  logoutButton.textContent = "登出";
  logoutHandler = async () => {
    logoutButton.disabled = true;
    clearProtectedUi();
    await logoutUser();
  };
  logoutButton.addEventListener("click", logoutHandler, { once: true });
  account.append(image, avatar, details, logoutButton);
  accountHost.appendChild(account);
}
