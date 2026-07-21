import { firestoreErrorMessage } from "../services/auth-service.js";
import { compareNames } from "../utils/item-logic.js";
import { confirmModal, openModal, closeModal } from "../ui/modal.js";
import { notify } from "../ui/notifications.js";
import {
  approvePendingUser, deleteAuthorizedUser, deletePendingUser,
  getManagedUsers, updateAuthorizedUser,
} from "../services/user-service.js";

let session = null;
let state = { authorized: [], pending: [] };

function makePhoto(user) {
  const wrapper = document.createElement("div");
  const image = document.createElement("img");
  image.className = "user-photo";
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  const fallback = document.createElement("span");
  fallback.className = "user-photo user-photo-fallback";
  fallback.textContent = (user.displayName || user.email || "U").trim().charAt(0).toUpperCase();
  fallback.hidden = true;
  const useFallback = () => { image.hidden = true; fallback.hidden = false; };
  image.addEventListener("error", useFallback);
  if (user.photoURL) image.src = user.photoURL;
  else useFallback();
  wrapper.append(image, fallback);
  return wrapper;
}

function field(label, control) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const caption = document.createElement("label");
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function roleSelect(value, disabled = false) {
  const select = document.createElement("select");
  select.disabled = disabled;
  for (const role of ["member", "admin"]) {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    option.selected = role === value;
    select.appendChild(option);
  }
  return select;
}

function identity(user, identityBadge = null) {
  const summary = document.createElement("div");
  summary.className = "user-summary";
  const details = document.createElement("div");
  details.className = "user-identity";
  const name = document.createElement("strong");
  name.textContent = user.displayName || "未設定顯示名稱";
  const nameLine = document.createElement("div");
  nameLine.className = "user-name-line";
  nameLine.appendChild(name);
  if (identityBadge) nameLine.appendChild(identityBadge);
  const email = document.createElement("span");
  email.textContent = user.email || "無 Email";
  details.append(nameLine, email);
  summary.append(makePhoto(user), details);
  return summary;
}

function badge(text, kind) {
  const span = document.createElement("span");
  span.className = `badge badge-${kind} badge-plain user-badge`;
  span.textContent = text;
  return span;
}

function actionButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await handler(); }
    catch (error) {
      console.error(error);
      notify.danger(firestoreErrorMessage(error));
    }
    finally { if (button.isConnected) button.disabled = false; }
  });
  return button;
}

/** Compact row: avatar + name/email + badges + actions. */
function userRow(user, badges, actions, identityBadge = null) {
  const row = document.createElement("article");
  row.className = "user-row";
  row.append(identity(user, identityBadge));
  const meta = document.createElement("div");
  meta.className = "user-row-badges";
  badges.forEach((b) => b && meta.appendChild(b));
  const actionWrap = document.createElement("div");
  actionWrap.className = "user-row-actions";
  actions.forEach((a) => a && actionWrap.appendChild(a));
  row.append(meta, actionWrap);
  return row;
}

function pendingCard(user) {
  return userRow(user,
    [badge("等待授權", "warning")],
    [
      actionButton("同意", "btn btn-primary btn-sm", () => openApproveModal(user)),
      actionButton("刪除", "btn btn-ghost btn-sm", async () => {
        const confirmed = await confirmModal({
          title: "刪除等待申請",
          message: `確定刪除 ${user.email || "此帳號"} 的申請嗎？`,
          detail: "刪除後，此帳號仍可再次登入並重新申請授權。",
          confirmText: "刪除申請", danger: true,
        });
        if (!confirmed) return;
        await deletePendingUser(user.uid);
        notify.success("已刪除申請");
        await loadUsers();
      }),
    ]);
}

function authorizedCard(user) {
  const isSelf = user.uid === session.user.uid;
  const role = user.role === "admin" ? "admin" : "member";
  const remove = actionButton("移除", "btn btn-ghost btn-sm", async () => {
    const confirmed = await confirmModal({
      title: "移除使用者授權",
      message: `確定移除 ${user.email || "此帳號"} 的系統使用權嗎？`,
      detail: "不會刪除 Google/Firebase Authentication 帳號；此人之後可再次登入申請授權。",
      confirmText: "移除授權", danger: true,
    });
    if (!confirmed) return;
    await deleteAuthorizedUser(user.uid);
    notify.success("已移除使用者授權");
    await loadUsers();
  });
  remove.disabled = isSelf;
  if (isSelf) remove.title = "不能移除目前登入的管理員";
  return userRow(user,
    [
      badge(role, role === "admin" ? "info" : "muted"),
      badge(user.enabled === false ? "停用" : "啟用", user.enabled === false ? "danger" : "success"),
    ],
    [
      actionButton("編輯", "btn btn-ghost btn-sm", () => openEditModal(user, isSelf)),
      remove,
    ],
    isSelf ? badge("目前帳號", "info") : null);
}

/* ---------- edit / approve modals ---------- */

function openApproveModal(user) {
  const name = document.createElement("input");
  name.value = user.displayName || "";
  name.placeholder = "顯示名稱";
  const role = roleSelect("member");
  const body = document.createElement("div");
  body.append(field("顯示名稱", name), field("Role", role));

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex; gap:10px";
  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost"; cancel.textContent = "取消"; cancel.type = "button";
  const save = document.createElement("button");
  save.className = "btn btn-primary"; save.textContent = "同意授權"; save.type = "button";
  footer.append(cancel, save);
  openModal({ title: `授權 ${user.email || "使用者"}`, body, footer, maxWidth: "420px" });
  cancel.addEventListener("click", () => closeModal());
  save.addEventListener("click", async () => {
    save.disabled = cancel.disabled = true;
    try {
      await approvePendingUser(user, { displayName: name.value, role: role.value });
      notify.success("已授權使用者");
      closeModal();
      await loadUsers();
    } catch (error) {
      console.error(error);
      notify.danger(firestoreErrorMessage(error));
      save.disabled = cancel.disabled = false;
    }
  });
}

function openEditModal(user, isSelf) {
  const name = document.createElement("input");
  name.value = user.displayName || "";
  name.placeholder = "顯示名稱";
  const role = roleSelect(user.role || "member", isSelf);
  const body = document.createElement("div");
  body.append(field("顯示名稱", name), field("Role", role));
  if (isSelf) {
    const note = document.createElement("p");
    note.className = "user-meta";
    note.textContent = "不能變更自己的角色。";
    body.appendChild(note);
  }
  const uid = document.createElement("div");
  uid.className = "user-meta";
  uid.textContent = `UID：${user.uid}`;
  body.appendChild(uid);

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex; gap:10px";
  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost"; cancel.textContent = "取消"; cancel.type = "button";
  const save = document.createElement("button");
  save.className = "btn btn-primary"; save.textContent = "儲存變更"; save.type = "button";
  footer.append(cancel, save);
  openModal({ title: `編輯 ${user.displayName || user.email || "使用者"}`, body, footer, maxWidth: "420px" });
  cancel.addEventListener("click", () => closeModal());
  save.addEventListener("click", async () => {
    save.disabled = cancel.disabled = true;
    try {
      await updateAuthorizedUser(user.uid, { displayName: name.value, role: role.value });
      notify.success("已更新使用者");
      closeModal();
      await loadUsers();
    } catch (error) {
      console.error(error);
      notify.danger(firestoreErrorMessage(error));
      save.disabled = cancel.disabled = false;
    }
  });
}

function renderList(hostId, users, renderer, countId, emptyMessage) {
  const host = document.getElementById(hostId);
  document.getElementById(countId).textContent = String(users.length);
  host.replaceChildren();
  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "card state-block empty-users";
    empty.textContent = emptyMessage;
    host.appendChild(empty);
    return;
  }
  users.forEach((user) => host.appendChild(renderer(user)));
}

async function loadUsers() {
  try {
    state = await getManagedUsers();
    state.pending.sort((a, b) => compareNames(a.displayName || a.email, b.displayName || b.email));
    state.authorized.sort((a, b) => compareNames(a.displayName || a.email, b.displayName || b.email));
    renderList("pending-users", state.pending, pendingCard, "pending-count", "目前沒有等待授權的帳號。");
    renderList("authorized-users", state.authorized, authorizedCard, "authorized-count", "目前沒有已授權使用者。");
  } catch (error) {
    console.error(error);
    const collection = error.collectionName ? `（${error.collectionName}）` : "";
    const hint = error.code === "permission-denied"
      ? "請確認 Firebase Console 已發布專案最新的 firestore.rules。"
      : "";
    notify.danger(`${firestoreErrorMessage(error)}${collection}${hint ? ` ${hint}` : ""}`, { duration: 8000 });
  }
}

export async function mountPage(context) {
  session = context.session;
  state = { authorized: [], pending: [] };
  document.getElementById("refresh-users").addEventListener("click", loadUsers);
  await loadUsers();
}
