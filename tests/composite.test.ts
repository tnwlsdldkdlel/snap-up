import { describe, expect, it } from 'vitest';
import { compositeInto, countProtectedDiff, embedRGBA } from '../lib/composite';

const px = (...vals: number[][]) => Uint8ClampedArray.from(vals.flat());

describe('compositeInto', () => {
  it('W=0은 기준 픽셀 그대로, W=255는 AI 그대로, 중간은 섞임, 알파는 255', () => {
    const base = px([10, 20, 30, 255], [10, 20, 30, 255], [10, 20, 30, 255]);
    const ai = px([200, 200, 200, 0], [200, 200, 200, 0], [200, 200, 200, 0]);
    const out = compositeInto(ai, base, Uint8Array.from([0, 128, 255]));
    expect([...out.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...out.subarray(8, 12)]).toEqual([200, 200, 200, 255]);
    expect(out[4]).toBeGreaterThan(10);
    expect(out[4]).toBeLessThan(200);
    expect(out[7]).toBe(255);
  });
});

describe('countProtectedDiff', () => {
  it('보호 영역이 같으면 0, 1px 바뀌면 1, 편집 영역 차이는 무시', () => {
    const base = px([1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255]);
    const weight = Uint8Array.from([0, 0, 255]);
    const same = px([1, 2, 3, 255], [4, 5, 6, 255], [99, 99, 99, 255]);
    expect(countProtectedDiff(base, same, weight)).toBe(0);
    const changed = px([1, 2, 3, 255], [4, 5, 7, 255], [99, 99, 99, 255]);
    expect(countProtectedDiff(base, changed, weight)).toBe(1);
  });
});

describe('embedRGBA', () => {
  it('확장 시 새 영역은 불투명 검정, 기준 픽셀은 오프셋 위치에', () => {
    const base = { w: 1, h: 1, data: px([5, 6, 7, 255]) };
    const out = embedRGBA(base, { cw: 2, ch: 1, ox: 1, oy: 0 });
    expect([...out.data]).toEqual([0, 0, 0, 255, 5, 6, 7, 255]);
  });
  it('크롭 시 음수 오프셋만큼 잘라낸다', () => {
    const base = { w: 3, h: 1, data: px([1, 1, 1, 255], [2, 2, 2, 255], [3, 3, 3, 255]) };
    const out = embedRGBA(base, { cw: 1, ch: 1, ox: -1, oy: 0 });
    expect([...out.data]).toEqual([2, 2, 2, 255]);
  });
});

describe('합성 → 검증 왕복', () => {
  it('합성 결과는 보호 영역 차이 0', () => {
    const n = 64;
    const base = new Uint8ClampedArray(n * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
    const ai = new Uint8ClampedArray(n * 4).fill(123);
    const weight = new Uint8Array(n).map((_, i) => (i < 32 ? 0 : i % 2 ? 255 : 90));
    const out = compositeInto(ai, base, weight);
    expect(countProtectedDiff(base, out, weight)).toBe(0);
  });
});
