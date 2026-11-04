import { useState } from "react";
import { Img, imageSrc } from "./Img";
import { Modal } from "./ui/overlay";
import type { ImageRef } from "~/lib/catalog";

/**
 * Product photos: one large picture (the page's largest contentful image: eager, high priority), thumbnails to switch, and a zoom dialog with the large
 * file. Without JavaScript the first photo shows and the page is complete; switching and zooming are enhancements.
 */
export function Gallery({ images, title }: { images: ImageRef[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const current = images[Math.min(index, images.length - 1)];
  if (!current) return <div className="gallery-empty" role="img" aria-label={`No photo yet for ${title}`}>No photo yet</div>;
  return (
    <div className="gallery">
      <button type="button" className="gallery-main" onClick={() => setZoom(true)} aria-label={`Zoom photo ${index + 1} of ${images.length}`}>
        <Img key={current.id} imageId={current.id} width={current.width} height={current.height} alt={current.alt} sizes="(min-width: 900px) 560px, 100vw" priority />
      </button>
      {images.length > 1 && (
        <ul className="gallery-thumbs" aria-label="Photos">
          {images.map((im, i) => (
            <li key={im.id}>
              <button type="button" aria-label={`Show photo ${i + 1} of ${images.length}`} aria-pressed={i === index} onClick={() => setIndex(i)}>
                <img src={imageSrc(im.id, 160, Math.round((160 * im.height) / im.width))} width={80} height={Math.round((80 * im.height) / im.width)} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={zoom} onClose={() => setZoom(false)} title={`${title}, photo ${index + 1}`}>
        {zoom && <img className="gallery-zoom" src={imageSrc(current.id, 1600, Math.round((1600 * current.height) / current.width))} width={1600} height={Math.round((1600 * current.height) / current.width)} alt={current.alt} />}
      </Modal>
    </div>
  );
}
