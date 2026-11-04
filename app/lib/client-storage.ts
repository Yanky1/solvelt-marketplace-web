/** Browser storage keys holding user-scoped data must start with this prefix so sign-out can clear exactly them. */
export const USER_STORAGE_PREFIX = "solvelt.user.";

/** Clears user-scoped keys only. Theme and other device preferences (cookie, other prefixes) are left alone. */
export function clearUserScopedStorage(stores: Pick<Storage, "length" | "key" | "removeItem">[]): void {
  for (const store of stores) {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith(USER_STORAGE_PREFIX)) doomed.push(k);
      }
      doomed.forEach((k) => store.removeItem(k));
    } catch {
      // Storage can be blocked (private mode); nothing to clear then.
    }
  }
}

export function clearUserScopedStorageInBrowser(): void {
  if (typeof window === "undefined") return;
  const stores: Storage[] = [];
  try { stores.push(window.localStorage); } catch { /* blocked */ }
  try { stores.push(window.sessionStorage); } catch { /* blocked */ }
  clearUserScopedStorage(stores);
}

/** Device-level marker (not user-scoped, so it survives clearing) holding the opaque id of the user the stored data belongs to. */
export const STORAGE_OWNER_KEY = "solvelt.device.storage-owner";

/**
 * Clears user-scoped keys when the signed-in user changes or disappears without the sign-out button being used
 * (session expiry, "sign out everywhere" from another device, a different person signing in on a shared computer).
 * Returns true when it cleared something.
 */
export function reconcileUserStorage(userId: string | null, stores: Pick<Storage, "length" | "key" | "removeItem" | "getItem" | "setItem">[], marker: Pick<Storage, "getItem" | "setItem" | "removeItem">): boolean {
  let previous: string | null = null;
  try { previous = marker.getItem(STORAGE_OWNER_KEY); } catch { return false; }
  let cleared = false;
  if (previous !== null && previous !== (userId ?? "")) {
    clearUserScopedStorage(stores);
    cleared = true;
  }
  try {
    if (userId) marker.setItem(STORAGE_OWNER_KEY, userId);
    else marker.removeItem(STORAGE_OWNER_KEY);
  } catch { /* storage blocked */ }
  return cleared;
}

export function reconcileUserStorageInBrowser(userId: string | null): void {
  if (typeof window === "undefined") return;
  const stores: Storage[] = [];
  try { stores.push(window.localStorage, window.sessionStorage); } catch { return; }
  reconcileUserStorage(userId, stores, stores[0]!);
}
