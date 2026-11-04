import type { ImgHTMLAttributes } from "react";

/** Widths the image route will serve (anything else is refused: the route is a resizer, not a proxy). */
export const IMAGE_WIDTHS = [160, 320, 480, 640, 800, 1200, 1600] as const;

export const imageSrc = (id: string, w: number, h: number): string => `/img/${encodeURIComponent(id)}?w=${w}&h=${h}`;

/** Widths worth offering for a picture of this natural width: the served steps up to it (never an upscaled file); the smallest step for a tiny picture. */
export function srcsetWidths(naturalWidth: number): number[] {
  const wanted = IMAGE_WIDTHS.filter((w) => w <= naturalWidth);
  return wanted.length === 0 ? [IMAGE_WIDTHS[0]] : wanted;
}

export interface ImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "width" | "height" | "alt" | "loading"> {
  imageId: string; width: number; height: number; alt: string; sizes: string;
  /** The largest-contentful image of the page: loaded eagerly with high fetch priority. Everything else is lazy. */
  priority?: boolean;
}

/** Responsive picture from our own resize route, with its natural size in the markup (no layout shift). */
export function Img({ imageId, width, height, alt, sizes, priority = false, ...rest }: ImgProps) {
  const widths = srcsetWidths(width);
  const srcSet = widths.map((w) => `${imageSrc(imageId, w, Math.round((w * height) / width))} ${w}w`).join(", ");
  const mid = widths[Math.min(2, widths.length - 1)]!;
  return (
    <img
      {...rest}
      src={imageSrc(imageId, mid, Math.round((mid * height) / width))}
      srcSet={srcSet}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      {...(priority ? { fetchPriority: "high" as const } : {})}
    />
  );
}
