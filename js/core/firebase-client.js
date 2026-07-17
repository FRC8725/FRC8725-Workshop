// Shared Firebase App singleton. Every Firebase module uses FIREBASE_SDK_VERSION.

import { firebaseConfig, FIREBASE_SDK_VERSION } from "./firebase-config.js";

let app = null;
let appSdk = null;
let db = null;
let firestoreSdk = null;

export async function getFirebaseApp() {
  if (app) return app;
  appSdk = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`
  );
  app = appSdk.getApps().length
    ? appSdk.getApp()
    : appSdk.initializeApp(firebaseConfig);
  return app;
}

export async function getFirebaseDb() {
  if (db) return { db, sdk: firestoreSdk };
  const appInstance = await getFirebaseApp();
  firestoreSdk = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`
  );
  db = firestoreSdk.getFirestore(appInstance);
  return { db, sdk: firestoreSdk };
}
