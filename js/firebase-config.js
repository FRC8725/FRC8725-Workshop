// js/firebase-config.js
//
// 請填入你自己的 Firebase 專案設定。
// 在填入之前，網站會自動改用 data/demo-items.json + localStorage 的示範模式，
// 不會崩潰，也不會出現空白頁。
//
// 只要 apiKey 或 projectId 仍為預設的 "YOUR_..." 值，
// 系統就會判定「Firebase 尚未設定」。

export const firebaseConfig = {
  apiKey: "AIzaSyAQZ0Fv-w8zRLE8X5EuZ969YMkRlblYX5E",
  authDomain: "frc8725-workshop.firebaseapp.com",
  projectId: "frc8725-workshop",
  storageBucket: "frc8725-workshop.firebasestorage.app",
  messagingSenderId: "817221104751",
  appId: "1:817221104751:web:2d1a2a5bd88d3a7c2c099a",
  measurementId: "G-PLSNF431WF"
};

// 使用的 Firebase Web SDK 版本（所有模組需一致）。
export const FIREBASE_SDK_VERSION = "10.12.2";

/** 判斷設定是否已經填入（非預設佔位值）。 */
export function isFirebaseConfigured() {
  const cfg = firebaseConfig;
  const looksSet = (v) => typeof v === "string" && v.length > 0 && !v.startsWith("YOUR_");
  return looksSet(cfg.apiKey) && looksSet(cfg.projectId);
}
