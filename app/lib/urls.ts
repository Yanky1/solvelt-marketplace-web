/** The one place that knows the catalog URL scheme. Slugs are ASCII (the API guarantees it); an id is only ever a fallback and is redirected to the slug. */
export const listingPath = (slug: string): string => `/p/${encodeURIComponent(slug)}`;
export const categoryPath = (slug: string): string => `/c/${encodeURIComponent(slug)}`;
export const brandPath = (slug: string): string => `/b/${encodeURIComponent(slug)}`;
export const sellerPath = (id: string): string => `/s/${encodeURIComponent(id)}`;
export const searchPath = (q: string): string => `/search?q=${encodeURIComponent(q)}`;
