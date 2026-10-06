import type { Frame, Size, Target } from './canvas';

/** 0..255, 255 = 편집 */
export type Mask = Uint8Array;
/** 0 지우기, 128 없음, 255 칠하기 */
export type Brush = { mask: Mask; w: number; h: number };
export const BRUSH_NONE = 128;

export function invert(m: Mask): Mask {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = 255 - m[i];
  return out;
}

export function resizeBilinear(src: Mask, sw: number, sh: number, dw: number, dh: number): Mask {
  const out = new Uint8Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return out;
}

export function paintBrush(layer: Mask, w: number, h: number, cx: number, cy: number, r: number, add: boolean) {
  const v = add ? 255 : 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) layer[y * w + x] = v;
}

/** 리사이즈로 생긴 중간값은 가까운 쪽으로 판정한다. */
export function applyBrush(seg: Mask, brush: Mask): Mask {
  const out = new Uint8Array(seg.length);
  for (let i = 0; i < seg.length; i++) out[i] = brush[i] > 170 ? 255 : brush[i] < 85 ? 0 : seg[i];
  return out;
}

/** seg가 없으면(인식 실패) 반전하지 않고 브러시 영역만 편집한다. 전체 편집으로 번지는 것을 막기 위함. */
export function buildEditMask(target: Target, seg: Mask | null, brush: Brush | null, base: Size): Mask | null {
  if (target === 'all') return null;
  let m = seg ? (target === 'background' ? invert(seg) : seg.slice()) : new Uint8Array(base.w * base.h);
  if (brush) m = applyBrush(m, resizeBilinear(brush.mask, brush.w, brush.h, base.w, base.h));
  return m;
}

function blurLine(src: Mask, dst: Mask, off: number, stride: number, n: number, r: number) {
  const at = (i: number) => src[off + Math.min(n - 1, Math.max(0, i)) * stride];
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += at(k);
  for (let i = 0; i < n; i++) {
    dst[off + i * stride] = Math.round(sum / (2 * r + 1));
    sum += at(i + r + 1) - at(i - r);
  }
}

export function boxBlur(m: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) blurLine(m, tmp, y * w, 1, w, r);
  for (let x = 0; x < w; x++) blurLine(tmp, out, x, w, h, r);
  return out;
}

/** min(A, blur(A)): A 밖은 정확히 0으로 남고 페더는 안쪽에만 생긴다. */
export function featherInside(a: Mask, w: number, h: number, r: number): Mask {
  const b = boxBlur(a, w, h, r);
  for (let i = 0; i < a.length; i++) if (a[i] < b[i]) b[i] = a[i];
  return b;
}

function dilateLine(src: Mask, dst: Mask, off: number, stride: number, n: number, r: number) {
  const on = (i: number) => (src[off + Math.min(n - 1, Math.max(0, i)) * stride] > 0 ? 1 : 0);
  let cnt = 0;
  for (let k = -r; k <= r; k++) cnt += on(k);
  for (let i = 0; i < n; i++) {
    dst[off + i * stride] = cnt > 0 ? 255 : 0;
    cnt += on(i + r + 1) - on(i - r);
  }
}

/** 0보다 큰 픽셀을 r만큼 사각형으로 넓힌 이진 마스크 */
export function dilate(m: Mask, w: number, h: number, r: number): Mask {
  const tmp = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) dilateLine(m, tmp, y * w, 1, w, r);
  for (let x = 0; x < w; x++) dilateLine(tmp, out, x, w, h, r);
  return out;
}

/** OpenAI 마스크: alpha 0 = 편집. 생성용이라 팽창시켜 이음새 여유를 준다(합성 권한은 weight가 제한). */
export function toApiMaskRGBA(m: Mask, w: number, h: number, dilatePx: number) {
  const d = dilate(m, w, h, dilatePx);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i++) out[i * 4 + 3] = 255 - d[i];
  return out;
}

function region(base: Size, f: Frame) {
  return {
    x0: Math.max(0, f.ox), x1: Math.min(f.cw, f.ox + base.w),
    y0: Math.max(0, f.oy), y1: Math.min(f.ch, f.oy + base.h),
  };
}

/** 기준 해상도 마스크를 프레임 좌표로 옮긴다. 기준 이미지 밖은 0. */
export function embed(m: Mask, base: Size, f: Frame): Mask {
  const out = new Uint8Array(f.cw * f.ch);
  const { x0, x1, y0, y1 } = region(base, f);
  for (let y = y0; y < y1; y++) {
    const s = (y - f.oy) * base.w + (x0 - f.ox);
    out.set(m.subarray(s, s + (x1 - x0)), y * f.cw + x0);
  }
  return out;
}

/** 확장으로 새로 생긴 영역 = 255 */
export function newAreaMask(base: Size, f: Frame): Mask {
  const out = new Uint8Array(f.cw * f.ch).fill(255);
  const { x0, x1, y0, y1 } = region(base, f);
  for (let y = y0; y < y1; y++) out.fill(0, y * f.cw + x0, y * f.cw + x1);
  return out;
}

export function assemble(edit: Mask | null, base: Size, f: Frame, featherPx: number) {
  const na = newAreaMask(base, f);
  const e = edit ? embed(edit, base, f) : new Uint8Array(f.cw * f.ch);
  const fe = featherInside(e, f.cw, f.ch, featherPx);
  const approved = new Uint8Array(na.length);
  const weight = new Uint8Array(na.length);
  for (let i = 0; i < na.length; i++) {
    approved[i] = Math.max(e[i], na[i]);
    weight[i] = Math.max(fe[i], na[i]);
  }
  return { approved, weight };
}

/** 모델 매트의 양 끝 잡음(≤lo → 0, ≥hi → 255)을 정리한다. 복사본을 반환. */
export function snapMatte(m: Mask, lo = 8, hi = 247): Mask {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = m[i] <= lo ? 0 : m[i] >= hi ? 255 : m[i];
  return out;
}

export function any(m: Mask): boolean {
  for (let i = 0; i < m.length; i++) if (m[i] !== 0) return true;
  return false;
}
