import { describe, expect, it } from 'vitest';
import { expectText, formatElapsed, percentOf, stepIndex } from '../lib/progress';
import { GENERATE_STEPS } from '../lib/pipeline';

describe('progress', () => {
  it('경과 시간을 m:ss로', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(23_900)).toBe('0:23');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
  it('생성 단계 문구로 현재 단계를 찾고, 다른 문구는 -1', () => {
    expect(stepIndex(GENERATE_STEPS, GENERATE_STEPS[1])).toBe(1);
    expect(stepIndex(GENERATE_STEPS, '인물 인식 중')).toBe(-1);
  });
  it('문구 속 진행률만 뽑고 100을 넘지 않는다', () => {
    expect(percentOf('모델 불러오는 중 · 42% (11/26MB)')).toBe(42);
    expect(percentOf('인물 인식 중')).toBeNull();
    expect(percentOf('999%')).toBe(100);
  });
  it('예상 시간을 넘기면 안내 문구가 바뀐다', () => {
    expect(expectText(10_000, 45)).toBe('보통 45초 내외');
    expect(expectText(50_000, 45)).toMatch(/오래 걸리고/);
    expect(expectText(10_000)).toBe('');
  });
});
