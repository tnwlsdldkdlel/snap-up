import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/edit/route';

const file = (type: string, bytes = 3) => new File([new Uint8Array(bytes)], 'f', { type });
const valid = (): Record<string, string | File> => ({
  image: file('image/jpeg'),
  mask: file('image/png'),
  size: '2336x1552',
  target: 'background',
  prompt: '노을 지는 바다',
  expanded: '0',
});
const req = (fields: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request('http://x/api/edit', { method: 'POST', body: fd });
};

describe('POST /api/edit', () => {
  beforeEach(() => vi.stubEnv('OPENAI_API_KEY', 'sk-test'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('입력이 잘못되면 400이고 OpenAI를 호출하지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(req({ ...valid(), image: 'https://evil.example/x.jpg' }))).status).toBe(400);
    expect((await POST(req({ ...valid(), mask: file('image/jpeg') }))).status).toBe(400);
    expect((await POST(req({ ...valid(), size: '1000x1000' }))).status).toBe(400);
    expect((await POST(req({ ...valid(), target: 'sky' }))).status).toBe(400);
    const bad = await POST(req({ ...valid(), prompt: '   ' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('bad_prompt');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('파일 합계가 본문 예산을 넘으면 413', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await POST(req({ ...valid(), image: file('image/jpeg', 4_400_001) }))).status).toBe(413);
  });

  it('키가 없으면 503', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await POST(req(valid()))).status).toBe(503);
  });

  it('성공 시 gpt-image-2로 요청하고 응답 본문을 그대로 넘긴다', async () => {
    const body = JSON.stringify({ data: [{ b64_json: 'QUJD' }] });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req(valid()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const sent = init.body as FormData;
    expect(sent.get('model')).toBe('gpt-image-2');
    expect(sent.get('size')).toBe('2336x1552');
    expect(sent.get('output_format')).toBe('png');
    expect(String(sent.get('prompt'))).toMatch(/User request: 노을 지는 바다/);
  });

  it('레퍼런스가 있으면 원본을 첫 장으로 image[]에 함께 보내고 프롬프트에 참고용임을 알린다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const fd = new FormData();
    for (const [k, v] of Object.entries(valid())) fd.append(k, v);
    fd.append('reference', file('image/jpeg', 5));
    fd.append('reference', file('image/jpeg', 7));
    expect((await POST(new Request('http://x/api/edit', { method: 'POST', body: fd }))).status).toBe(200);
    const sent = fetchMock.mock.calls[0][1].body as FormData;
    expect(sent.get('image')).toBeNull();
    expect(sent.getAll('image[]').map((f) => (f as File).name)).toEqual(['image.jpg', 'reference-1.jpg', 'reference-2.jpg']);
    expect(String(sent.get('prompt'))).toMatch(/first image is the photo to edit/);
  });

  it('레퍼런스가 JPEG가 아니거나 너무 많으면 400, 합계가 예산을 넘으면 413', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const withRefs = (refs: (string | File)[]) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(valid())) fd.append(k, v);
      refs.forEach((r) => fd.append('reference', r));
      return new Request('http://x/api/edit', { method: 'POST', body: fd });
    };
    expect((await POST(withRefs([file('image/png')]))).status).toBe(400);
    expect((await POST(withRefs(['https://evil.example/r.jpg']))).status).toBe(400);
    expect((await POST(withRefs(Array.from({ length: 4 }, () => file('image/jpeg'))))).status).toBe(400);
    expect((await POST(withRefs([file('image/jpeg', 4_400_000)]))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI 전체 + 프롬프트는 마스크 없이 보내고 전체 편집 지시를 쓴다. 마스크가 오면 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { mask: _mask, ...noMask } = valid();
    expect((await POST(req({ ...noMask, target: 'all', prompt: '노을 분위기로' }))).status).toBe(200);
    const sent = fetchMock.mock.calls[0][1].body as FormData;
    expect(sent.get('mask')).toBeNull();
    expect(String(sent.get('prompt'))).toMatch(/whole photo/);
    expect((await POST(req({ ...valid(), target: 'all', prompt: '노을 분위기로' }))).status).toBe(400);
    expect((await POST(req({ ...noMask, target: 'background' }))).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('허용 목록의 모델만 그대로 넘기고, 목록 밖 모델은 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(req({ ...valid(), model: 'gpt-image-2.5-sunburst' }))).status).toBe(200);
    expect((fetchMock.mock.calls[0][1].body as FormData).get('model')).toBe('gpt-image-2.5-sunburst');
    expect((await POST(req({ ...valid(), model: 'dall-e-2' }))).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('OpenAI 429·정책 거부를 구분해 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
    expect((await POST(req(valid()))).status).toBe(429);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":"moderation_blocked"}}', { status: 400 })));
    const res = await POST(req(valid()));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('policy');
  });

  it('OpenAI fetch 실패하면 502 upstream error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req(valid()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('upstream');
  });
});
