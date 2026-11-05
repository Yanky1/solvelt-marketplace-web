export declare const gid: (name: string) => string;
export declare function catalogResponse(path: string, url: URL | string): { status: number; headers?: Record<string, string>; body?: unknown } | null;
export declare const IMAGE_BAD: string;
export declare const IMAGE_DOWN: string;
export declare function imageInfo(id: string): { width: number; height: number; title: string } | null;
export declare const variantInfo: (id: string) => { listing: Record<string, unknown>; variant: Record<string, unknown> } | null;
export declare const DEMO_SLUGS: Set<string>;
export declare const listingById: (id: string) => Record<string, unknown> | null;
