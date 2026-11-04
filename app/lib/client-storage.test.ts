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
