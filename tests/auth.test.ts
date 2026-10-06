import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkBasicAuth } from '../lib/auth';
import { proxy } from '../proxy';

const basic = (s: string) => 'Basic ' + Buffer.from(s, 'utf8').toString('base64');

describe('checkBasicAuth', () => {
  it('비밀번호 미설정이면 misconfigured', () => {
    expect(checkBasicAuth(basic('u:pw'), undefined)).toBe('misconfigured');
    expect(checkBasicAuth(basic('u:pw'), '')).toBe('misconfigured');
  });
  it('헤더 없음·형식 오류·불일치는 unauthorized', () => {
    expect(checkBasicAuth(null, 'pw')).toBe('unauthorized');
    expect(checkBasicAuth('Bearer x', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth('Basic %%%', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth(basic('u:pw2'), 'pw')).toBe('unauthorized');
  });
  it('사용자명은 무시하고 비밀번호가 맞으면 ok (한글 비밀번호 포함)', () => {
    expect(checkBasicAuth(basic('아무나:pw'), 'pw')).toBe('ok');
    expect(checkBasicAuth(basic('me:비밀번호'), '비밀번호')).toBe('ok');
  });
});

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('APP_PASSWORD 없으면 503', () => {
    vi.stubEnv('APP_PASSWORD', '');
    expect(proxy(new NextRequest('http://x/api/edit')).status).toBe(503);
  });
  it('인증 없으면 401 + WWW-Authenticate', () => {
    vi.stubEnv('APP_PASSWORD', 'pw');
    const res = proxy(new NextRequest('http://x/'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Basic/);
  });
  it('맞으면 통과', () => {
    vi.stubEnv('APP_PASSWORD', 'pw');
    const res = proxy(new NextRequest('http://x/', { headers: { authorization: basic('u:pw') } }));
    expect(res.status).toBe(200);
  });
});
