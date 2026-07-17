// js/notifications.js — toast notification component

import { icon } from "./utils.js";

const ICONS = {
  success: icon("check", { size: "16px" }),
  warning: icon("alert", { size: "16px" }),
  danger: icon("x", { size: "16px" }),
  info: icon("info", { size: "16px" }),
};

let stack = null;

function ensureStack() {
  if (stack) return stack;
  stack = document.createElement("div");
  stack.className = "toast-stack";
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("aria-atomic", "false");
  document.body.appendChild(stack);
  return stack;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {"success"|"warning"|"danger"|"info"} type
 * @param {{title?:string, duration?:number}} opts
 */
export function toast(message, type = "info", opts = {}) {
  const host = ensureStack();
  const { title = "", duration = 3600 } = opts;

  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.setAttribute("role", type === "danger" ? "alert" : "status");
  node.innerHTML = `
    <div class="toast-ico">${ICONS[type] || ICONS.info}</div>
    <div class="toast-body">
      ${title ? `<div class="toast-title"></div>` : ""}
      <div class="toast-msg"></div>
    </div>
    <button class="toast-x" aria-label="關閉通知">×</button>
  `;
  if (title) node.querySelector(".toast-title").textContent = title;
  node.querySelector(".toast-msg").textContent = message;

  const remove = () => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 200);
  };
  node.querySelector(".toast-x").addEventListener("click", remove);
  host.appendChild(node);

  if (duration > 0) setTimeout(remove, duration);
  return remove;
}

export const notify = {
  success: (m, o) => toast(m, "success", o),
  warning: (m, o) => toast(m, "warning", o),
  danger: (m, o) => toast(m, "danger", o),
  info: (m, o) => toast(m, "info", o),
};
