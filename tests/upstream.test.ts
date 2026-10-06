import { describe, expect, it } from 'vitest';
import { mapUpstreamError, userMessage } from '../lib/upstream';

describe('mapUpstreamError', () => {
  it('429 → rate/429, moderation → policy/422, 그 외 → upstream/502', () => {
    expect(mapUpstreamError(429, '')).toEqual({ payload: { error: 'rate', status: 429 }, httpStatus: 429 });
    expect(mapUpstreamError(400, '{"error":{"code":"moderation_blocked"}}').payload.error).toBe('policy');
    expect(mapUpstreamError(400, '{"error":{"code":"moderation_blocked"}}').httpStatus).toBe(422);
    expect(mapUpstreamError(500, 'x')).toEqual({ payload: { error: 'upstream', status: 500 }, httpStatus: 502 });
  });
});

describe('userMessage', () => {
  it('코드별 안내, 504는 시간 초과, JSON이 아니면 상태 코드 포함', () => {
    expect(userMessage(422, { error: 'policy' })).toMatch(/정책/);
    expect(userMessage(429, { error: 'rate' })).toMatch(/잠시 후/);
    expect(userMessage(400, { error: 'bad_prompt', message: '수정 내용을 입력하세요.' })).toBe('수정 내용을 입력하세요.');
    expect(userMessage(504, null)).toMatch(/시간/);
    expect(userMessage(500, null)).toMatch(/500/);
  });
});
