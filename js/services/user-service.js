// Firestore user administration. Authentication accounts are never deleted here;
// removing authorization lets the same Google account apply again later.

import { getCurrentUser } from "./auth-service.js";
import { getFirebaseDb } from "../core/firebase-client.js";

const AUTHORIZED = "authorizedUsers";
const PENDING = "pendingUsers";

function mapSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({ uid: entry.id, ...entry.data() }));
}

async function getCollection(db, sdk, collectionName) {
  try {
    return await sdk.getDocs(sdk.collection(db, collectionName));
  } catch (error) {
    error.collectionName = collectionName;
    throw error;
  }
}

async function firestore() {
  if (!getCurrentUser()) {
    throw Object.assign(new Error("登入狀態已失效"), { code: "unauthenticated" });
  }
  return getFirebaseDb();
}

export async function submitPendingRequest(user) {
  if (!user) throw Object.assign(new Error("尚未登入"), { code: "unauthenticated" });
  const { db, sdk } = await firestore();
  const reference = sdk.doc(db, PENDING, user.uid);
  const existing = await sdk.getDoc(reference);
  const profile = {
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    lastAttemptAt: sdk.serverTimestamp(),
  };
  if (existing.exists()) {
    await sdk.updateDoc(reference, profile);
  } else {
    await sdk.setDoc(reference, { ...profile, requestedAt: sdk.serverTimestamp() });
  }
}

export async function getManagedUsers() {
  const { db, sdk } = await firestore();
  const [authorized, pending] = await Promise.all([
    getCollection(db, sdk, AUTHORIZED),
    getCollection(db, sdk, PENDING),
  ]);
  return { authorized: mapSnapshot(authorized), pending: mapSnapshot(pending) };
}

export async function approvePendingUser(pendingUser, { displayName, role }) {
  const { db, sdk } = await firestore();
  const batch = sdk.writeBatch(db);
  batch.set(sdk.doc(db, AUTHORIZED, pendingUser.uid), {
    email: pendingUser.email || "",
    displayName: displayName.trim() || pendingUser.displayName || "",
    enabled: true,
    role: role === "admin" ? "admin" : "member",
    photoURL: pendingUser.photoURL || "",
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  });
  batch.delete(sdk.doc(db, PENDING, pendingUser.uid));
  await batch.commit();
}

export async function updateAuthorizedUser(uid, { displayName, role }) {
  const { db, sdk } = await firestore();
  await sdk.updateDoc(sdk.doc(db, AUTHORIZED, uid), {
    displayName: displayName.trim(),
    role: role === "admin" ? "admin" : "member",
    updatedAt: sdk.serverTimestamp(),
  });
}

export async function deleteAuthorizedUser(uid) {
  const { db, sdk } = await firestore();
  await sdk.deleteDoc(sdk.doc(db, AUTHORIZED, uid));
}

export async function deletePendingUser(uid) {
  const { db, sdk } = await firestore();
  await sdk.deleteDoc(sdk.doc(db, PENDING, uid));
}
