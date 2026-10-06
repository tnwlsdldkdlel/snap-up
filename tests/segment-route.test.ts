import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/segment/route';

const req = (fields: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request('http://x/api/segment', { method: 'POST', body: fd });
};
const jpeg = () => new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });

describe('POST /api/segment', () => {
  beforeEach(() => vi.stubEnv('FAL_KEY', 'test-key'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('URL 문자열이나 JPEG가 아닌 파일은 400, fal을 호출하지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(req({ image: 'https://evil.example/a.jpg' }))).status).toBe(400);
    expect((await POST(req({ image: new File(['x'], 'a.png', { type: 'image/png' }) }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FAL_KEY가 없으면 503', async () => {
    vi.stubEnv('FAL_KEY', '');
    expect((await POST(req({ image: jpeg() }))).status).toBe(503);
  });

  it('성공 시 data URI 마스크를 PNG 바이트로 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ mask_image: { url: 'data:image/png;base64,' + Buffer.from([9, 8, 7]).toString('base64') } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req({ image: jpeg() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 8, 7]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/birefnet/v2');
    expect(init.headers.Authorization).toBe('Key test-key');
    expect(JSON.parse(init.body).output_mask).toBe(true);
  });

  it('fal 오류나 data URI가 아닌 응답은 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    expect((await POST(req({ image: jpeg() }))).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ mask_image: { url: 'https://cdn/x.png' } })));
    expect((await POST(req({ image: jpeg() }))).status).toBe(502);
  });
});
