/**
 * Registry application helpers — client-side (uses Firebase client SDK).
 *
 * Firestore collection: registry_applications/{uid}
 */

import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

export type RegistryStatus = "pending" | "approved" | "rejected";

export interface RegistryApplication {
  user_id: string;
  status: RegistryStatus;
  metadata: Record<string, unknown>;
  created_at: unknown;
}

/**
 * Create or overwrite the registry application for a user.
 * Always resets status to "pending" on (re-)submission.
 */
export async function submitRegistryApplication(
  uid: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const ref = doc(db, "registry_applications", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      user_id: uid,
      status: "pending" satisfies RegistryStatus,
      metadata,
      created_at: serverTimestamp(),
    });
    return;
  }

  await updateDoc(ref, {
    user_id: uid,
    status: "pending" satisfies RegistryStatus,
    metadata,
  });
}

/**
 * Read the registry application for a user.
 * Returns null if no application exists yet.
 */
export async function getRegistryApplication(
  uid: string
): Promise<RegistryApplication | null> {
  const snap = await getDoc(doc(db, "registry_applications", uid));
  return snap.exists() ? (snap.data() as RegistryApplication) : null;
}
