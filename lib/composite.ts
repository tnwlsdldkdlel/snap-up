import type { Frame } from './canvas';
import type { Mask } from './mask';

export type RGBA = { w: number; h: number; data: Uint8ClampedArray<ArrayBuffer> };

export function embedRGBA(base: RGBA, f: Frame): RGBA {
  const data = new Uint8ClampedArray(f.cw * f.ch * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const x0 = Math.max(0, f.ox);
  const x1 = Math.min(f.cw, f.ox + base.w);
  const y0 = Math.max(0, f.oy);
  const y1 = Math.min(f.ch, f.oy + base.h);
  for (let y = y0; y < y1; y++) {
    const s = ((y - f.oy) * base.w + (x0 - f.ox)) * 4;
    data.set(base.data.subarray(s, s + (x1 - x0) * 4), (y * f.cw + x0) * 4);
  }
  return { w: f.cw, h: f.ch, data };
}

/** out = W·ai + (1−W)·base. 메모리 절약을 위해 ai 버퍼를 덮어쓴다. */
export function compositeInto(ai: Uint8ClampedArray, base: Uint8ClampedArray, weight: Mask) {
  for (let p = 0, i = 0; p < weight.length; p++, i += 4) {
    const w = weight[p];
    if (w === 0) {
      ai[i] = base[i];
      ai[i + 1] = base[i + 1];
      ai[i + 2] = base[i + 2];
    } else if (w !== 255) {
      for (let c = 0; c < 3; c++) ai[i + c] = (ai[i + c] * w + base[i + c] * (255 - w) + 127) / 255;
    }
    ai[i + 3] = 255;
  }
  return ai;
}

export function countProtectedDiff(base: Uint8ClampedArray, out: Uint8ClampedArray, weight: Mask): number {
  let n = 0;
  for (let p = 0, i = 0; p < weight.length; p++, i += 4)
    if (weight[p] === 0 && (base[i] !== out[i] || base[i + 1] !== out[i + 1] || base[i + 2] !== out[i + 2])) n++;
  return n;
}
