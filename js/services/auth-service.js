// Google Authentication and Firestore-backed authorization.

import { FIREBASE_SDK_VERSION, isFirebaseConfigured } from "../core/firebase-config.js";
import { getFirebaseApp, getFirebaseDb } from "../core/firebase-client.js";
import { debugLog } from "../core/debug-mode.js";

let auth = null;
let authSdk = null;
let provider = null;
let redirectChecked = false;
let authUnsubscribe = null;
const authObservers = new Set();

async function initAuth() {
  if (auth) return auth;
  if (!isFirebaseConfigured()) throw Object.assign(new Error("Firebase 尚未設定"), { code: "app/not-configured" });
  const app = await getFirebaseApp();
  authSdk = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`);
  auth = authSdk.getAuth(app);
  // Keep the session across reloads so a page refresh does not bounce back to login.
  try { await authSdk.setPersistence(auth, authSdk.browserLocalPersistence); }
  catch (error) { console.warn("無法設定登入持久化，改用預設。", error); }
  provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return auth;
}

async function handleRedirectResult() {
  const instance = await initAuth();
  if (redirectChecked) return null;
  redirectChecked = true;
  try {
    return await authSdk.getRedirectResult(instance);
  } catch (error) {
    // A dropped redirect handshake (storage-partitioned mobile browsers) must not
    // block auth init — onAuthStateChanged still resolves the current user.
    console.warn("處理重新導向登入結果時發生問題（可忽略，將改用彈出視窗）。", error);
    return null;
  }
}

export function authErrorMessage(error) {
  switch (error?.code) {
    case "auth/popup-closed-by-user": return "Popup 已關閉，登入未完成。";
    case "auth/popup-blocked": return "瀏覽器封鎖登入視窗，將改用重新導向登入。";
    case "auth/cancelled-popup-request": return "已有另一個登入視窗正在處理。";
    case "auth/network-request-failed": return "網路連線失敗，請檢查連線後再試。";
    case "auth/unauthorized-domain": return "此網站網域尚未加入 Firebase 授權網域。";
    case "auth/account-exists-with-different-credential": return "此 Email 已使用其他登入方式建立。";
    case "auth/configuration-not-found": return "Firebase Authentication 尚未啟用，或 Google 登入供應商尚未完成設定。";
    case "auth/operation-not-allowed": return "此 Firebase 專案尚未啟用 Google 登入。";
    case "app/not-configured": return "Firebase 尚未完成設定。";
    default: return "Google 登入失敗，請稍後再試。";
  }
}

export function firestoreErrorMessage(error, authorization = false) {
  switch (error?.code) {
    case "permission-denied": return authorization ? "目前帳號未被授權使用此系統。" : "目前帳號沒有資料存取權限。";
    case "unauthenticated": return "登入狀態已失效，請重新登入。";
    case "unavailable": return "Firebase 服務暫時無法使用。";
    case "resource-exhausted": return "Firestore 讀寫配額暫時不足，已優先使用本機快取；請稍後再試。";
    case "failed-precondition": return "Firebase 資料庫尚未完成必要設定。";
    default: return authorization ? "無法載入授權資料。" : "無法載入 Firebase 資料。";
  }
}

export async function loginWithGoogle() {
  const instance = await initAuth();
  // Popup first on every device. signInWithRedirect breaks on mobile browsers that
  // partition storage (iOS Safari / in-app webviews) with
  // "Unable to process request due to missing initial state", because the redirect
  // handshake state kept in sessionStorage is dropped. Popup avoids that entirely.
  try {
    return await authSdk.signInWithPopup(instance, provider);
  } catch (error) {
    const fallbackToRedirect = error?.code === "auth/popup-blocked"
      || error?.code === "auth/operation-not-supported-in-environment"
      || error?.code === "auth/cancelled-popup-request";
    if (fallbackToRedirect) {
      await authSdk.signInWithRedirect(instance, provider);
      return null;
    }
    throw error;
  }
}

export async function logoutUser() {
  const instance = await initAuth();
  await authSdk.signOut(instance);
}

export async function observeAuthState(callback) {
  const instance = await initAuth();
  await handleRedirectResult();
  authObservers.add(callback);
  if (!authUnsubscribe) {
    authUnsubscribe = authSdk.onAuthStateChanged(instance, (user) => {
      authObservers.forEach((observer) => observer(user));
    });
  } else {
    callback(instance.currentUser);
  }
  return () => authObservers.delete(callback);
}

export function getCurrentUser() {
  return auth?.currentUser || null;
}

export async function checkCurrentUserAuthorization() {
  const user = getCurrentUser();
  if (!user) return { authorized: false, role: null, profile: null };
  const { db, sdk } = await getFirebaseDb();
  debugLog(`[Firestore 讀取] authorizedUsers/${user.uid}｜確認登入授權`);
  const snapshot = await sdk.getDoc(sdk.doc(db, "authorizedUsers", user.uid));
  if (!snapshot.exists() || snapshot.data()?.enabled !== true) {
    return { authorized: false, role: null, profile: null };
  }
  const profile = snapshot.data();
  const role = profile.role;
  if (role !== "member" && role !== "admin") {
    return { authorized: false, role: null, profile: null };
  }
  return { authorized: true, role, profile };
}
