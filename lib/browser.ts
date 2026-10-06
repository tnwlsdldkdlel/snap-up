import type { RGBA } from './composite';

export async function decodeFile(blob: Blob): Promise<RGBA> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    return drawToRGBA(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

/** alpha:false로 그려 모든 픽셀을 불투명 8bit sRGB로 정규화한다. */
export function drawToRGBA(src: CanvasImageSource, w: number, h: number): RGBA {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

export function rgbaToCanvas(img: RGBA): OffscreenCanvas {
  const c = new OffscreenCanvas(img.w, img.h);
  c.getContext('2d')!.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
  return c;
}

export const resizeRGBA = (img: RGBA, w: number, h: number) => drawToRGBA(rgbaToCanvas(img), w, h);

export const encode = (img: RGBA, type: 'image/png' | 'image/jpeg', quality?: number) =>
  rgbaToCanvas(img).convertToBlob({ type, quality });

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
