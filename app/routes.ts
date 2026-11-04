import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("theme", "routes/theme.ts"),
  route("healthz", "routes/healthz.ts"),
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("styleguide", "routes/styleguide.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
