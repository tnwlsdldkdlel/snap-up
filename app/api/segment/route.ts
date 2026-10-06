import { MAX_BODY_BYTES } from '../../../lib/limits';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ENDPOINT = 'https://fal.run/fal-ai/birefnet/v2';
const MODEL = 'Portrait'; // Task 2 실측 결과로 확정

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail('too_large', 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('bad_request', 400);
  }
  const image = form.get('image');
  if (!(image instanceof File) || image.type !== 'image/jpeg') return fail('bad_request', 400);
  if (image.size > MAX_BODY_BYTES) return fail('too_large', 413);
  const key = process.env.FAL_KEY;
  if (!key) return fail('misconfigured', 503);

  const dataUri = 'data:image/jpeg;base64,' + Buffer.from(await image.arrayBuffer()).toString('base64');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: dataUri,
      model: MODEL,
      operating_resolution: '2048x2048',
      output_mask: true,
      sync_mode: true,
    }),
  });
  if (!res.ok) return fail('upstream', 502);
  const url: unknown = (await res.json())?.mask_image?.url;
  // sync_mode 응답의 data URI만 받는다. 서버가 외부 URL을 가져오는 경로를 만들지 않기 위함.
  const m = typeof url === 'string' ? url.match(/^data:image\/png;base64,(.+)$/s) : null;
  if (!m) return fail('upstream', 502);
  return new Response(new Uint8Array(Buffer.from(m[1], 'base64')), { headers: { 'Content-Type': 'image/png' } });
}
