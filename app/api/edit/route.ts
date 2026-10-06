import { isValidModelSize, type Target } from '../../../lib/canvas';
import { MAX_BODY_BYTES } from '../../../lib/limits';
import { buildPrompt, promptError } from '../../../lib/prompt';
import { mapUpstreamError } from '../../../lib/upstream';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = 'gpt-image-2';
const TARGETS: Target[] = ['background', 'person', 'none'];

const fail = (error: string, status: number, extra: object = {}) => Response.json({ error, ...extra }, { status });

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
  const size = String(form.get('size') ?? '');
  const target = String(form.get('target') ?? '') as Target;
  const userPrompt = String(form.get('prompt') ?? '');
  const expanded = form.get('expanded') === '1';

  if (!(image instanceof File) || image.type !== 'image/jpeg') return fail('bad_request', 400);
  if (!(mask instanceof File) || mask.type !== 'image/png') return fail('bad_request', 400);
  if (image.size + mask.size > MAX_BODY_BYTES) return fail('too_large', 413);
  if (!TARGETS.includes(target)) return fail('bad_request', 400);
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m || !isValidModelSize(Number(m[1]), Number(m[2]))) return fail('bad_request', 400);
  const perr = promptError(target, userPrompt, expanded);
  if (perr) return fail('bad_prompt', 400, { message: perr });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fail('misconfigured', 503);

  const fd = new FormData();
  fd.append('model', MODEL);
  fd.append('prompt', buildPrompt(target, userPrompt, expanded));
  fd.append('size', size);
  fd.append('quality', 'high');
  fd.append('output_format', 'png');
  fd.append('n', '1');
  fd.append('image', image, 'image.jpg');
  fd.append('mask', mask, 'mask.png');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
  } catch {
    return fail('upstream', 502);
  }

  if (!res.ok) {
    const { payload, httpStatus } = mapUpstreamError(res.status, await res.text());
    return Response.json(payload, { status: httpStatus });
  }
  // 4.5MB 응답 제한을 피하려고 본문을 버퍼링하지 않고 스트리밍으로 넘긴다.
  return new Response(res.body, { headers: { 'Content-Type': 'application/json' } });
}
