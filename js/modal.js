// js/modal.js — accessible modal dialog helper

let activeModal = null;
let lastFocused = null;

function trapFocus(e) {
  if (!activeModal || e.key !== "Tab") return;
  const focusables = activeModal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const list = Array.from(focusables).filter((n) => !n.disabled && n.offsetParent !== null);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

function onKeydown(e) {
  if (e.key === "Escape") closeModal();
  else trapFocus(e);
}

/**
 * Open a modal.
 * @param {{title:string, body:HTMLElement|string, footer?:HTMLElement, onClose?:Function, maxWidth?:string}} cfg
 * @returns {{overlay:HTMLElement, close:Function}}
 */
export function openModal(cfg) {
  closeModal();
  lastFocused = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h2 id="modal-title"></h2>
        <button class="modal-close" aria-label="關閉">×</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  const modal = overlay.querySelector(".modal");
  if (cfg.maxWidth) modal.style.maxWidth = cfg.maxWidth;
  overlay.querySelector("#modal-title").textContent = cfg.title;

  const bodyHost = overlay.querySelector(".modal-body");
  if (typeof cfg.body === "string") bodyHost.innerHTML = cfg.body;
  else bodyHost.appendChild(cfg.body);

  if (cfg.footer) {
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    foot.appendChild(cfg.footer);
    modal.appendChild(foot);
  }

  overlay.querySelector(".modal-close").addEventListener("click", () => closeModal());
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeModal();
  });

  document.body.appendChild(overlay);
  activeModal = overlay;
  activeModal._onClose = cfg.onClose;
  document.addEventListener("keydown", onKeydown);
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    const firstInput = modal.querySelector("input, select, textarea, button:not(.modal-close)");
    if (firstInput) firstInput.focus();
  });

  return { overlay, close: closeModal };
}

export function closeModal() {
  if (!activeModal) return;
  const overlay = activeModal;
  const cb = overlay._onClose;
  activeModal = null;
  document.removeEventListener("keydown", onKeydown);
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 160);
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  if (typeof cb === "function") cb();
}

/**
 * Confirmation dialog. Resolves true/false.
 */
export function confirmModal({ title, message, confirmText = "確認", danger = false, detail = "" }) {
  return new Promise((resolve) => {
    const body = document.createElement("div");
    body.innerHTML = `
      <p style="margin-top:0">${message}</p>
      ${detail ? `<div class="banner banner-danger" style="margin:0">${detail}</div>` : ""}
    `;
    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.gap = "10px";

    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "取消";
    const ok = document.createElement("button");
    ok.className = danger ? "btn btn-danger" : "btn btn-primary";
    ok.textContent = confirmText;

    footer.append(cancel, ok);
    const { close } = openModal({ title, body, footer, maxWidth: "420px", onClose: () => resolve(false) });

    cancel.addEventListener("click", () => close());
    ok.addEventListener("click", () => {
      ok._confirmed = true;
      activeCleanupResolve(resolve, true);
      close();
    });
  });
}

// Helper to avoid double-resolution of confirm promise.
function activeCleanupResolve(resolve, value) {
  if (activeModal) activeModal._onClose = null;
  resolve(value);
}
