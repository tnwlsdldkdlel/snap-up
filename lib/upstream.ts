export type UpstreamCode = 'policy' | 'rate' | 'upstream';

export function mapUpstreamError(status: number, body: string) {
  if (status === 429) return { payload: { error: 'rate' as UpstreamCode, status }, httpStatus: 429 };
  if (status === 400 && /moderation|safety/i.test(body))
    return { payload: { error: 'policy' as UpstreamCode, status }, httpStatus: 422 };
  return { payload: { error: 'upstream' as UpstreamCode, status }, httpStatus: 502 };
}

export function userMessage(status: number, body: unknown): string {
  const b = (body ?? {}) as { error?: string; message?: string };
  switch (b.error) {
    case 'policy': return '콘텐츠 정책으로 거부됐어요. 프롬프트를 바꿔보세요.';
    case 'rate': return '요청이 많아요. 잠시 후 다시 시도하세요.';
    case 'too_large': return '요청이 너무 커요. 다른 비율을 고르세요.';
    case 'bad_prompt': return b.message ?? '프롬프트를 확인하세요.';
    case 'misconfigured': return '서버 설정(API 키)이 빠졌어요.';
  }
  if (status === 504) return '시간이 초과됐어요. 다시 시도하세요.';
  return `요청에 실패했어요 (${status}). 다시 시도하세요.`;
}
