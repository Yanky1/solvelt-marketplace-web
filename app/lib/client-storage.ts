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
