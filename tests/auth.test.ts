import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkBasicAuth } from '../lib/auth';
import { proxy } from '../proxy';

const basic = (s: string) => 'Basic ' + Buffer.from(s, 'utf8').toString('base64');

describe('checkBasicAuth', () => {
  it('아이디나 비밀번호가 미설정이면 misconfigured', () => {
    expect(checkBasicAuth(basic('me:pw'), 'me', undefined)).toBe('misconfigured');
    expect(checkBasicAuth(basic('me:pw'), 'me', '')).toBe('misconfigured');
    expect(checkBasicAuth(basic('me:pw'), undefined, 'pw')).toBe('misconfigured');
    expect(checkBasicAuth(basic('me:pw'), '', 'pw')).toBe('misconfigured');
  });
  it('헤더 없음·형식 오류·불일치는 unauthorized', () => {
    expect(checkBasicAuth(null, 'me', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth('Bearer x', 'me', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth('Basic %%%', 'me', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth(basic('mepw'), 'me', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth(basic('me:pw2'), 'me', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth(basic('you:pw'), 'me', 'pw')).toBe('unauthorized');
    expect(checkBasicAuth(basic(':pw'), 'me', 'pw')).toBe('unauthorized');
  });
  it('아이디와 비밀번호가 모두 맞으면 ok (한글, 비밀번호 속 콜론 포함)', () => {
    expect(checkBasicAuth(basic('me:pw'), 'me', 'pw')).toBe('ok');
    expect(checkBasicAuth(basic('수진:비밀:번호'), '수진', '비밀:번호')).toBe('ok');
  });
});

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('APP_ID나 APP_PASSWORD가 없으면 503', () => {
    vi.stubEnv('APP_ID', 'me');
    vi.stubEnv('APP_PASSWORD', '');
    expect(proxy(new NextRequest('http://x/api/edit')).status).toBe(503);
    vi.stubEnv('APP_ID', '');
    vi.stubEnv('APP_PASSWORD', 'pw');
    expect(proxy(new NextRequest('http://x/api/edit')).status).toBe(503);
  });
  it('인증 없으면 401 + WWW-Authenticate', () => {
    vi.stubEnv('APP_ID', 'me');
    vi.stubEnv('APP_PASSWORD', 'pw');
    const res = proxy(new NextRequest('http://x/'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Basic/);
  });
  it('아이디가 틀리면 401, 둘 다 맞으면 통과', () => {
    vi.stubEnv('APP_ID', 'me');
    vi.stubEnv('APP_PASSWORD', 'pw');
    expect(proxy(new NextRequest('http://x/', { headers: { authorization: basic('u:pw') } })).status).toBe(401);
    expect(proxy(new NextRequest('http://x/', { headers: { authorization: basic('me:pw') } })).status).toBe(200);
  });
});
