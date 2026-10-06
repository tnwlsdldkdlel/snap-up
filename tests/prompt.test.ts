import { describe, expect, it } from 'vitest';
import { buildPrompt, promptError } from '../lib/prompt';

describe('buildPrompt', () => {
  it('공통 규칙(마스크만, 워터마크 금지)과 사용자 요청을 포함', () => {
    const p = buildPrompt('person', '  셔츠를 파란색으로  ', false);
    expect(p).toMatch(/ONLY the transparent/);
    expect(p).toMatch(/watermark/i);
    expect(p).toMatch(/User request: 셔츠를 파란색으로$/);
  });
  it('배경은 인물 조명에 맞추라는 지시, 확장은 이어 그리기 지시', () => {
    expect(buildPrompt('background', '바다', false)).toMatch(/lighting direction/);
    expect(buildPrompt('none', '', true)).toMatch(/newly added/);
    expect(buildPrompt('none', '', true)).not.toMatch(/User request/);
  });
});

describe('promptError', () => {
  it('대상이 있는데 공백만 입력하면 막는다', () => {
    expect(promptError('background', '   ', false)).not.toBeNull();
  });
  it('2000자 초과를 막는다', () => {
    expect(promptError('person', 'a'.repeat(2001), false)).not.toBeNull();
  });
  it('대상 없음 + 확장 없음은 수정할 영역이 없다', () => {
    expect(promptError('none', '', false)).not.toBeNull();
  });
  it('대상 없음 + 확장은 프롬프트 없이 허용', () => {
    expect(promptError('none', '', true)).toBeNull();
  });
});
