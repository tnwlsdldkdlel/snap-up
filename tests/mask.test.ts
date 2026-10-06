import { describe, expect, it } from 'vitest';
import {
  BRUSH_NONE, any, applyBrush, assemble, buildEditMask, dilate, embed, featherInside,
  invert, newAreaMask, paintBrush, resizeBilinear, toApiMaskRGBA,
} from '../lib/mask';
import { planFrame } from '../lib/canvas';

const square = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255;
  return m;
};

describe('기본 연산', () => {
  it('invert', () => {
    expect([...invert(Uint8Array.from([0, 100, 255]))]).toEqual([255, 155, 0]);
  });
  it('resizeBilinear: 균일 값 유지, 크기 변경', () => {
    const out = resizeBilinear(new Uint8Array(4).fill(200), 2, 2, 5, 3);
    expect(out.length).toBe(15);
    expect(out.every((v) => v === 200)).toBe(true);
  });
  it('paintBrush + applyBrush: 칠하기 255, 지우기 0, 나머지는 seg 유지', () => {
    const layer = new Uint8Array(25).fill(BRUSH_NONE);
    paintBrush(layer, 5, 5, 1, 1, 0.6, true);
    paintBrush(layer, 5, 5, 3, 3, 0.6, false);
    const seg = new Uint8Array(25).fill(100);
    const out = applyBrush(seg, layer);
    expect(out[1 * 5 + 1]).toBe(255);
    expect(out[3 * 5 + 3]).toBe(0);
    expect(out[0]).toBe(100);
  });
});

describe('buildEditMask', () => {
  const base = { w: 4, h: 1 };
  const seg = Uint8Array.from([255, 255, 0, 0]);
  it('none은 null', () => {
    expect(buildEditMask('none', seg, null, base)).toBeNull();
  });
  it('person은 seg 그대로, background는 반전', () => {
    expect([...buildEditMask('person', seg, null, base)!]).toEqual([255, 255, 0, 0]);
    expect([...buildEditMask('background', seg, null, base)!]).toEqual([0, 0, 255, 255]);
  });
  it('seg 없이 background를 골라도 전체 반전하지 않고 브러시 영역만 편집', () => {
    const brush = { mask: Uint8Array.from([BRUSH_NONE, 255, BRUSH_NONE, BRUSH_NONE]), w: 4, h: 1 };
    expect([...buildEditMask('background', null, brush, base)!]).toEqual([0, 255, 0, 0]);
    expect(any(buildEditMask('background', null, null, base)!)).toBe(false);
  });
});

describe('featherInside', () => {
  it('A 밖은 정확히 0, 중심은 255, 안쪽 가장자리는 255 미만', () => {
    const w = 20, h = 20;
    const a = square(w, h, 5, 5, 15, 15);
    const W = featherInside(a, w, h, 2);
    for (let i = 0; i < a.length; i++) if (a[i] === 0) expect(W[i]).toBe(0);
    expect(W[10 * w + 10]).toBe(255);
    expect(W[5 * w + 5]).toBeLessThan(255);
  });
});

describe('dilate / toApiMaskRGBA', () => {
  it('한 점이 r=1이면 3x3으로 커진다', () => {
    const m = new Uint8Array(25);
    m[12] = 255;
    const d = dilate(m, 5, 5, 1);
    expect([...d].filter((v) => v === 255).length).toBe(9);
    expect(d[0]).toBe(0);
  });
  it('API 마스크: 편집(팽창 포함) 픽셀은 alpha 0, 나머지 255, RGB 0', () => {
    const m = new Uint8Array(25);
    m[12] = 10;
    const rgba = toApiMaskRGBA(m, 5, 5, 1);
    expect(rgba[12 * 4 + 3]).toBe(0);
    expect(rgba[6 * 4 + 3]).toBe(0);
    expect(rgba[0 * 4 + 3]).toBe(255);
    expect(rgba[0]).toBe(0);
  });
});

describe('embed / newAreaMask / assemble', () => {
  const base = { w: 4, h: 2 };
  it('확장: 새 영역은 approved·weight 모두 255, 기준 영역은 편집 없으면 0', () => {
    const f = { cw: 4, ch: 4, ox: 0, oy: 1 };
    expect([...newAreaMask(base, f)]).toEqual([
      255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255,
    ]);
    const { approved, weight } = assemble(null, base, f, 1);
    expect([...approved]).toEqual([...newAreaMask(base, f)]);
    expect([...weight]).toEqual([...newAreaMask(base, f)]);
  });
  it('크롭: 편집 없음이면 approved가 비어 AI 호출이 필요 없다', () => {
    const f = planFrame({ w: 6, h: 4 }, 1, 'crop');
    expect(f).toEqual({ cw: 4, ch: 4, ox: -1, oy: 0 });
    expect(any(assemble(null, { w: 6, h: 4 }, f, 1).approved)).toBe(false);
  });
  it('크롭 embed는 오프셋만큼 잘라 옮긴다', () => {
    const m = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...embed(m, base, { cw: 2, ch: 2, ox: -1, oy: 0 })]).toEqual([2, 3, 6, 7]);
  });
});
