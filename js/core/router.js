// Hash router: swaps only #page-outlet; the sidebar and Firebase session stay alive.

import { icon as vectorIcon } from "../utils/utils.js";

const ROUTES = {
  home: { fragment: "pages/home.html", module: "../pages/home.js", roles: ["member", "admin"], label: "平面圖總覽", icon: "map" },
  storage: { fragment: "pages/storage.html", module: "../pages/storage.js", roles: ["member", "admin"] },
  users: { fragment: "pages/users.html", module: "../pages/users.js", roles: ["admin"], label: "使用者", icon: "users" },
};

let session = null;
let cleanup = null;
let started = false;
let renderRevision = 0;

export function routeTo(name, params = {}) {
  const query = new URLSearchParams(params).toString();
  location.hash = `#/${name}${query ? `?${query}` : ""}`;
}

export function readRoute() {
  const raw = location.hash.replace(/^#\/?/, "") || "home";
  const [name, query = ""] = raw.split("?");
  return { name: ROUTES[name] ? name : "home", params: new URLSearchParams(query) };
}

export function renderNavigation(activeName = readRoute().name) {
  const host = document.getElementById("primary-nav");
  if (!host) return;
  host.replaceChildren();
  if (!session) return;
  for (const [name, route] of Object.entries(ROUTES)) {
    if (!route.label || !route.roles.includes(session.role)) continue;
    const link = document.createElement("a");
    link.className = "nav-link";
    link.href = `#/${name}`;
    link.title = route.label;
    link.classList.toggle("active", name === activeName || (activeName === "storage" && name === "home"));
    const icon = document.createElement("span");
    icon.className = "ico";
    icon.innerHTML = vectorIcon(route.icon, { size: "18px" });
    const label = document.createElement("span");
    label.className = "nav-label";
    label.textContent = route.label;
    link.append(icon, label);
    host.appendChild(link);
  }
}

export async function renderRoute() {
  const revision = ++renderRevision;
  if (!session) return;
  const routeState = readRoute();
  let route = ROUTES[routeState.name];
  if (!route.roles.includes(session.role)) {
    routeTo("home");
    return;
  }
  cleanup?.();
  cleanup = null;
  renderNavigation(routeState.name);
  const outlet = document.getElementById("page-outlet");
  outlet.innerHTML = '<div class="state-block"><div class="spinner"></div>載入頁面…</div>';
  try {
    const [response, controller] = await Promise.all([fetch(route.fragment), import(route.module)]);
    if (!response.ok) throw new Error(`無法載入 ${route.fragment}`);
    const html = await response.text();
    if (revision !== renderRevision) return;
    outlet.innerHTML = html;
    document.title = `${route.label || "櫃子詳細"} · Team 8725 培訓室管理`;
    cleanup = await controller.mountPage({ session, params: routeState.params, routeTo }) || null;
  } catch (error) {
    console.error(error);
    outlet.innerHTML = `<div class="error-page"><h1>頁面載入失敗</h1><p>${error.message}</p></div>`;
  }
}

export function startRouter(nextSession) {
  session = nextSession;
  if (!started) {
    window.addEventListener("hashchange", renderRoute);
    started = true;
  }
  if (!location.hash || location.hash === "#/") location.hash = "#/home";
  else renderRoute();
}

export function stopRouter() {
  renderRevision++;
  cleanup?.();
  cleanup = null;
  session = null;
  renderNavigation();
}
