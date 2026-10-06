import { describe, expect, it } from 'vitest';
import { anchorFromOffset, checkFrame, fitModelSize, isValidModelSize, planFrame } from '../lib/canvas';

const base = { w: 6000, h: 4000 };

describe('planFrame', () => {
  it('원본 비율(null)은 크기 그대로', () => {
    expect(planFrame(base, null, 'expand')).toEqual({ cw: 6000, ch: 4000, ox: 0, oy: 0 });
  });
  it('같은 비율 프리셋은 확장 영역 0', () => {
    expect(planFrame(base, 3 / 2, 'expand')).toEqual({ cw: 6000, ch: 4000, ox: 0, oy: 0 });
    expect(planFrame(base, 3 / 2, 'crop')).toEqual({ cw: 6000, ch: 4000, ox: 0, oy: 0 });
  });
  it('3:2 → 4:5 확장은 위아래로 늘리고 가운데 배치', () => {
    expect(planFrame(base, 4 / 5, 'expand')).toEqual({ cw: 6000, ch: 7500, ox: 0, oy: 1750 });
  });
  it('3:2 → 1:1 크롭은 좌우를 자르고 음수 오프셋', () => {
    expect(planFrame(base, 1, 'crop')).toEqual({ cw: 4000, ch: 4000, ox: -1000, oy: 0 });
  });
  it('앵커 0은 왼쪽/위 정렬', () => {
    expect(planFrame({ w: 4000, h: 6000 }, 1, 'expand', { x: 0, y: 0 })).toEqual({ cw: 6000, ch: 6000, ox: 0, oy: 0 });
  });
});

describe('checkFrame', () => {
  it('60MP 초과를 막는다', () => {
    expect(checkFrame(base, planFrame(base, 9 / 16, 'expand'))).toMatch(/60MP/);
  });
  it('면적 2배 초과를 막는다', () => {
    const small = { w: 3000, h: 2000 };
    expect(checkFrame(small, planFrame(small, 9 / 16, 'expand'))).toMatch(/2배/);
  });
  it('허용 범위면 null', () => {
    expect(checkFrame(base, planFrame(base, 4 / 5, 'expand'))).toBeNull();
  });
});

describe('anchorFromOffset', () => {
  it('확장: 오프셋을 여유 공간 비율로 바꾸고 0..1로 자른다', () => {
    const f = planFrame(base, 4 / 5, 'expand');
    expect(anchorFromOffset(base, f, 0, 3500)).toEqual({ x: 0.5, y: 1 });
    expect(anchorFromOffset(base, f, 0, 9999)).toEqual({ x: 0.5, y: 1 });
  });
  it('크롭: 음수 오프셋도 같은 방향 비율', () => {
    const f = planFrame(base, 1, 'crop');
    expect(anchorFromOffset(base, f, -2000, 0)).toEqual({ x: 1, y: 0.5 });
  });
});

describe('fitModelSize', () => {
  it('3:2는 2336x1552 (16의 배수, 상한 이하)', () => {
    const s = fitModelSize(6000, 4000);
    expect(s).toEqual({ w: 2336, h: 1552 });
    expect(isValidModelSize(s.w, s.h)).toBe(true);
  });
  it('작은 사진도 상한 근처로 키운다', () => {
    const s = fitModelSize(800, 600);
    expect(isValidModelSize(s.w, s.h)).toBe(true);
    expect(s.w * s.h).toBeGreaterThan(3_000_000);
  });
  it('3:1 극단 비율도 유효', () => {
    const s = fitModelSize(1000, 3000);
    expect(isValidModelSize(s.w, s.h)).toBe(true);
  });
  it('16의 배수가 아니거나 상한 초과면 무효', () => {
    expect(isValidModelSize(1000, 1000)).toBe(false);
    expect(isValidModelSize(2560, 1456)).toBe(false);
    expect(isValidModelSize(3200, 1008)).toBe(false); // 3.17:1
  });
});
