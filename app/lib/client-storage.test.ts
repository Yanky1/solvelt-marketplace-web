import { describe, expect, it } from "vitest";
import { clearUserScopedStorage, clearUserScopedStorageInBrowser, USER_STORAGE_PREFIX } from "./client-storage";

describe("clearUserScopedStorage", () => {
  it("removes only user-scoped keys from both stores and keeps preferences", () => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem(`${USER_STORAGE_PREFIX}cartDraft`, "x");
    localStorage.setItem("solvelt.device.theme-hint", "dark");
    sessionStorage.setItem(`${USER_STORAGE_PREFIX}checkout`, "y");
    sessionStorage.setItem("unrelated", "z");
    clearUserScopedStorageInBrowser();
    expect(localStorage.getItem(`${USER_STORAGE_PREFIX}cartDraft`)).toBeNull();
    expect(sessionStorage.getItem(`${USER_STORAGE_PREFIX}checkout`)).toBeNull();
    expect(localStorage.getItem("solvelt.device.theme-hint")).toBe("dark");
    expect(sessionStorage.getItem("unrelated")).toBe("z");
  });
  it("survives a store that throws", () => {
    const bad = { get length(): number { throw new Error("blocked"); }, key: () => null, removeItem: () => {} };
    expect(() => clearUserScopedStorage([bad])).not.toThrow();
  });
});

import { reconcileUserStorage, STORAGE_OWNER_KEY } from "./client-storage";

describe("reconcileUserStorage", () => {
  const fresh = () => { localStorage.clear(); sessionStorage.clear(); };
  const run = (uid: string | null) => reconcileUserStorage(uid, [localStorage, sessionStorage], localStorage);
  const seed = () => { localStorage.setItem(`${USER_STORAGE_PREFIX}cart`, "x"); sessionStorage.setItem(`${USER_STORAGE_PREFIX}draft`, "y"); localStorage.setItem("solvelt.device.other", "keep"); };

  it("keeps data for the same user and records the owner", () => {
    fresh(); expect(run("u1")).toBe(false); seed(); expect(run("u1")).toBe(false);
    expect(localStorage.getItem(`${USER_STORAGE_PREFIX}cart`)).toBe("x");
    expect(localStorage.getItem(STORAGE_OWNER_KEY)).toBe("u1");
  });
  it("clears user data when the user disappears (expiry, remote sign-out) and keeps device keys", () => {
    fresh(); run("u1"); seed();
    expect(run(null)).toBe(true);
    expect([localStorage.getItem(`${USER_STORAGE_PREFIX}cart`), sessionStorage.getItem(`${USER_STORAGE_PREFIX}draft`), localStorage.getItem("solvelt.device.other")]).toEqual([null, null, "keep"]);
    expect(localStorage.getItem(STORAGE_OWNER_KEY)).toBeNull();
  });
  it("clears when a different user signs in on the same browser", () => {
    fresh(); run("u1"); seed();
    expect(run("u2")).toBe(true);
    expect(localStorage.getItem(`${USER_STORAGE_PREFIX}cart`)).toBeNull();
    expect(localStorage.getItem(STORAGE_OWNER_KEY)).toBe("u2");
  });
  it("does nothing for an anonymous browser that never had an owner", () => {
    fresh(); seed();
    expect(run(null)).toBe(false);
    expect(localStorage.getItem(`${USER_STORAGE_PREFIX}cart`)).toBe("x");
  });
  it("survives blocked storage", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
    expect(reconcileUserStorage("u1", [], bad)).toBe(false);
  });
});
