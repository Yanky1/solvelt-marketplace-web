export declare const gid: (name: string) => string;
export declare function catalogResponse(path: string, url: URL | string): { status: number; headers?: Record<string, string>; body?: unknown } | null;
export declare const variantInfo: (id: string) => { listing: Record<string, unknown>; variant: Record<string, unknown> } | null;
