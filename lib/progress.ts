/** 0:23, 1:05 형식 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 진행 문구가 몇 번째 단계인지. 단계 목록에 없으면 -1 */
export function stepIndex(steps: readonly string[], text: string): number {
  return steps.indexOf(text);
}

/** "모델 불러오는 중 · 42% (11/26MB)" 같은 문구에서 진행률을 뽑는다. 없으면 null */
export function percentOf(text: string): number | null {
  const m = /(\d{1,3})%/.exec(text);
  return m ? Math.min(100, Number(m[1])) : null;
}

/** 예상 시간 안내. 넘기면 조금 더 걸린다고 알린다 */
export function expectText(elapsedMs: number, expectSec?: number): string {
  if (!expectSec) return '';
  return elapsedMs / 1000 <= expectSec ? `보통 ${expectSec}초 내외` : '평소보다 오래 걸리고 있어요. 조금만 더 기다려 주세요';
}
