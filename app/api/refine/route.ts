import type { Target } from '../../../lib/canvas';
import { MAX_BODY_BYTES, MAX_PROMPT_CHARS } from '../../../lib/limits';
import { buildRefineRequest, parseRefineOutput, REFINE_MODEL } from '../../../lib/refine';
import { mapUpstreamError } from '../../../lib/upstream';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TARGETS: Target[] = ['all', 'background', 'person'];

const fail = (error: string, status: number) => Response.json({ error }, { status });
const dataUrl = async (f: File) => `data:${f.type};base64,${Buffer.from(await f.arrayBuffer()).toString('base64')}`;

/** 사진·편집 영역을 보고 사용자 프롬프트를 이미지 모델용 지시문으로 다듬는다. 결과는 사용자가 확인 후 생성에 쓴다 */
export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail('too_large', 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('bad_request', 400);
  }
  const image = form.get('image');
  const mask = form.get('mask');
  const target = String(form.get('target') ?? '') as Target;
  const prompt = String(form.get('prompt') ?? '');

  if (!(image instanceof File) || image.type !== 'image/jpeg') return fail('bad_request', 400);
  if (!(mask instanceof File) || mask.type !== 'image/png') return fail('bad_request', 400);
  if (image.size + mask.size > MAX_BODY_BYTES) return fail('too_large', 413);
  if (!TARGETS.includes(target)) return fail('bad_request', 400);
  if (!prompt.trim() || prompt.length > MAX_PROMPT_CHARS) return fail('bad_prompt', 400);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fail('misconfigured', 503);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRefineRequest(REFINE_MODEL, target, prompt, await dataUrl(image), await dataUrl(mask))),
    });
  } catch {
    return fail('upstream', 502);
  }
  if (!res.ok) {
    const { payload, httpStatus } = mapUpstreamError(res.status, await res.text());
    return Response.json(payload, { status: httpStatus });
  }
  const refined = parseRefineOutput(await res.json().catch(() => null));
  if (!refined) return fail('upstream', 502);
  return Response.json({ prompt: refined });
}
