import { gid } from "./mock-catalog.mjs";

// Every W1 page that must pass axe in light and dark (extended by later slices).
export const PAGES = [
  "/",
  "/styleguide",
  "/does-not-exist",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password?token=abc",
  "/reset-password",
  "/verify-email?sent=1",
  "/verify-email?token=abc",
  "/p/classic-braided-challah",
  "/search",
  "/search?q=challah&available=true&kosher=OU",
  "/search?q=zzzz",
  "/categories",
  "/c/food-drink",
  "/c/gifts?page=2",
  "/b/challah-corner",
  `/s/${gid("s:mazel")}`,
];
