export type AuthResult = 'ok' | 'unauthorized' | 'misconfigured';

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

/** 아이디와 비밀번호가 모두 맞아야 통과. 둘 중 하나라도 설정이 없으면 전부 막는다(fail closed) */
export function checkBasicAuth(header: string | null, id: string | undefined, password: string | undefined): AuthResult {
  if (!id || !password) return 'misconfigured';
  if (!header?.startsWith('Basic ')) return 'unauthorized';
  let decoded: string;
  try {
    const bin = atob(header.slice(6));
    decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return 'unauthorized';
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return 'unauthorized';
  // 어느 쪽이 틀렸는지 시간 차로 드러나지 않게 둘 다 비교한다
  const idOk = safeEqual(decoded.slice(0, sep), id);
  const pwOk = safeEqual(decoded.slice(sep + 1), password);
  return idOk && pwOk ? 'ok' : 'unauthorized';
}
