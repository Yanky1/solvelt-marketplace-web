export type ThemePref = "light" | "dark" | "system";
export const THEME_COOKIE = "solvelt_theme";

export function parseTheme(cookieHeader: string | null): ThemePref {
  const m = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)(?:;|$)`));
  return (m?.[1] as ThemePref | undefined) ?? "system";
}

export function themeCookie(pref: ThemePref, secure: boolean): string {
  // Not HttpOnly on purpose: it holds no secret and survives sign-out (user choice, not user data).
  return `${THEME_COOKIE}=${pref}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
