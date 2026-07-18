// js/ui/sidebar.js — collapsible sidebar (Claude-style rail), independent of auth/router state.

const STORAGE_KEY = "workshop.sidebarCollapsed";
const MOBILE_QUERY = "(max-width: 768px)";

function readStoredPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredPreference(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore (private mode / storage disabled) */
  }
}

export function initSidebarToggle() {
  const nav = document.getElementById("side-nav");
  const toggle = document.getElementById("sidebar-toggle");
  if (!nav || !toggle) return;

  const mobile = window.matchMedia(MOBILE_QUERY);

  function apply(collapsed) {
    nav.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = collapsed ? "展開側邊欄" : "收合側邊欄";
    toggle.setAttribute("aria-label", toggle.title);
  }

  function setCollapsed(collapsed, { persist = true } = {}) {
    apply(collapsed);
    if (persist) writeStoredPreference(collapsed);
  }

  toggle.addEventListener("click", () => {
    setCollapsed(!nav.classList.contains("collapsed"));
  });

  // On narrow / mobile layouts the sidebar becomes a horizontal top bar,
  // so force it back to the expanded (non-rail) look and hide the toggle.
  function syncWithViewport(event) {
    if (event.matches) {
      apply(false);
    } else {
      apply(readStoredPreference());
    }
  }
  mobile.addEventListener("change", syncWithViewport);
  syncWithViewport(mobile);
}
