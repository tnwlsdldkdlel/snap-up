export type AuthResult = 'ok' | 'unauthorized' | 'misconfigured';

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

export function checkBasicAuth(header: string | null, password: string | undefined): AuthResult {
  if (!password) return 'misconfigured';
  if (!header?.startsWith('Basic ')) return 'unauthorized';
  let decoded: string;
  try {
    const bin = atob(header.slice(6));
    decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return 'unauthorized';
  }
  return safeEqual(decoded.slice(decoded.indexOf(':') + 1), password) ? 'ok' : 'unauthorized';
}
