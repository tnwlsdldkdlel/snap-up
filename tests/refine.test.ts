import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/refine/route';
import { buildRefineRequest, parseRefineOutput, REFINE_MAX_CHARS, REFINE_MODEL } from '../lib/refine';

const message = (text: string) => ({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] });

describe('parseRefineOutput', () => {
  it('message의 output_text만 이어 붙여 다듬고, 없거나 비면 null', () => {
    expect(parseRefineOutput(message('  트렐리스에만 장미  '))).toBe('트렐리스에만 장미');
    expect(parseRefineOutput(message('   '))).toBeNull();
    expect(parseRefineOutput({ output: [{ type: 'reasoning' }] })).toBeNull();
    expect(parseRefineOutput(null)).toBeNull();
  });
  it('최대 길이로 자른다', () => {
    expect(parseRefineOutput(message('가'.repeat(REFINE_MAX_CHARS + 50)))).toHaveLength(REFINE_MAX_CHARS);
  });
});

describe('buildRefineRequest', () => {
  it('대상 설명과 요청을 텍스트로, 사진·마스크를 이미지로 순서대로 넣는다', () => {
    const body = buildRefineRequest('m', 'background', ' 장미 ', 'data:image/jpeg;base64,A', 'data:image/png;base64,B');
    const content = body.input[0].content;
    expect(content[0]).toEqual({ type: 'input_text', text: '편집 대상: 인물을 제외한 배경\n사용자 요청: 장미' });
    expect(content.slice(1).map((c) => (c as { image_url: string }).image_url)).toEqual(['data:image/jpeg;base64,A', 'data:image/png;base64,B']);
    expect(body.instructions).toMatch(/추가하지 않는다/);
  });
});

describe('POST /api/refine', () => {
  const file = (type: string, bytes = 3) => new File([new Uint8Array(bytes)], 'f', { type });
  const req = (fields: Record<string, string | File>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return new Request('http://x/api/refine', { method: 'POST', body: fd });
  };
  const valid = () => ({ image: file('image/jpeg'), mask: file('image/png'), target: 'background', prompt: '트렐리스에 장미' });

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
    expect((await POST(req({ ...valid(), target: 'sky' }))).status).toBe(400);
    expect((await POST(req({ ...valid(), prompt: '  ' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('성공 시 Responses API에 이미지를 data URL로 보내고 다듬은 문장만 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(message('다듬은 지시문')));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req(valid()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prompt: '다듬은 지시문' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(REFINE_MODEL);
    expect(body.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.input[0].content[2].image_url).toMatch(/^data:image\/png;base64,/);
  });

  it('빈 응답·실패는 502, 429는 그대로 구분', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ output: [] })));
    expect((await POST(req(valid()))).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow', { status: 429 })));
    expect((await POST(req(valid()))).status).toBe(429);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    expect((await POST(req(valid()))).status).toBe(502);
  });

  it('키가 없으면 503', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await POST(req(valid()))).status).toBe(503);
  });
});
