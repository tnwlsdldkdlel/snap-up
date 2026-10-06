import { isValidModelSize, type Target } from '../../../lib/canvas';
import { IMAGE_MODELS, MAX_BODY_BYTES, MAX_REFERENCES } from '../../../lib/limits';
import { buildPrompt, isWholeEdit, promptError } from '../../../lib/prompt';
import { mapUpstreamError } from '../../../lib/upstream';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TARGETS: Target[] = ['all', 'background', 'person'];

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
  const refs = form.getAll('reference');
  const model = String(form.get('model') ?? IMAGE_MODELS[0].id);

  if (!(image instanceof File) || image.type !== 'image/jpeg') return fail('bad_request', 400);
  // 전체 편집은 마스크 없이 보낸다. 그 외에는 필수
  const whole = isWholeEdit(target, userPrompt);
  if (whole ? mask !== null : !(mask instanceof File) || mask.type !== 'image/png') return fail('bad_request', 400);
  if (refs.length > MAX_REFERENCES || refs.some((r) => !(r instanceof File) || r.type !== 'image/jpeg')) return fail('bad_request', 400);
  const refFiles = refs as File[];
  if (image.size + (mask instanceof File ? mask.size : 0) + refFiles.reduce((s, r) => s + r.size, 0) > MAX_BODY_BYTES) return fail('too_large', 413);
  if (!TARGETS.includes(target)) return fail('bad_request', 400);
  if (!IMAGE_MODELS.some((m) => m.id === model)) return fail('bad_request', 400);
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m || !isValidModelSize(Number(m[1]), Number(m[2]))) return fail('bad_request', 400);
  const perr = promptError(target, userPrompt, expanded);
  if (perr) return fail('bad_prompt', 400, { message: perr });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fail('misconfigured', 503);

  const fd = new FormData();
  fd.append('model', model);
  fd.append('prompt', buildPrompt(target, userPrompt, expanded, refFiles.length));
  fd.append('size', size);
  fd.append('quality', 'high');
  fd.append('output_format', 'png');
  fd.append('n', '1');
  if (refFiles.length === 0) {
    fd.append('image', image, 'image.jpg');
  } else {
    // 여러 장이면 image[]로 보내고, mask는 첫 장(편집 대상)에만 적용된다
    fd.append('image[]', image, 'image.jpg');
    refFiles.forEach((r, i) => fd.append('image[]', r, `reference-${i + 1}.jpg`));
  }
  if (mask instanceof File) fd.append('mask', mask, 'mask.png');

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
