import { describe, expect, it } from 'vitest';
import { buildPrompt, isWholeEdit, promptError } from '../lib/prompt';

describe('buildPrompt', () => {
  it('공통 규칙(마스크만, 워터마크 금지)과 사용자 요청을 포함', () => {
    const p = buildPrompt('person', '  셔츠를 파란색으로  ', false);
    expect(p).toMatch(/ONLY the transparent/);
    expect(p).toMatch(/watermark/i);
    expect(p).toMatch(/User request: 셔츠를 파란색으로$/);
  });
  it('배경은 인물 조명에 맞추라는 지시, 확장은 이어 그리기 지시', () => {
    expect(buildPrompt('background', '바다', false)).toMatch(/lighting direction/);
    expect(buildPrompt('all', '', true)).toMatch(/newly added/);
    expect(buildPrompt('all', '', true)).not.toMatch(/User request/);
  });
  it('배경은 요청한 것만 바꾸고 기존 요소를 유지하라고 지시하며, 새 배경을 만들라고 하지 않는다', () => {
    const p = buildPrompt('background', '트렐리스에 장미', false);
    expect(p).toMatch(/Apply only the requested change/);
    expect(p).toMatch(/unchanged unless the request explicitly names it/);
    expect(p).not.toMatch(/new background/i);
  });
  it('레퍼런스가 있을 때만 첫 장이 편집 대상이고 나머지는 참고용이라고 알린다', () => {
    expect(buildPrompt('background', '장미', false, 2)).toMatch(/first image is the photo to edit/);
    expect(buildPrompt('background', '장미', false)).not.toMatch(/references only/);
  });
});

describe('전체 편집', () => {
  it('전체 + 프롬프트일 때만 마스크 없는 전체 편집 지시를 쓴다', () => {
    expect(isWholeEdit('all', '노을')).toBe(true);
    expect(isWholeEdit('all', '  ')).toBe(false);
    expect(isWholeEdit('background', '노을')).toBe(false);
    const p = buildPrompt('all', '노을', false);
    expect(p).toMatch(/whole photo/);
    expect(p).not.toMatch(/masked/);
    expect(buildPrompt('all', '', true)).toMatch(/ONLY the transparent/);
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
    expect(promptError('all', '', false)).not.toBeNull();
  });
  it('전체 + 프롬프트는 확장 없이도 허용', () => {
    expect(promptError('all', '노을 분위기로', false)).toBeNull();
  });
  it('대상 없음 + 확장은 프롬프트 없이 허용', () => {
    expect(promptError('all', '', true)).toBeNull();
  });
});
