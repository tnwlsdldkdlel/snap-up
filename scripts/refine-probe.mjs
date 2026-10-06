// 프롬프트 다듬기 결과를 모델별로 비교한다
// 실행: node --env-file=.env.local scripts/refine-probe.mjs <photo> <prompt> [--target background] [--mask m.png] [--models a,b]
// mask는 흰색 = 편집 가능. 없으면 전체 흰색(대상 설명만으로 판단)
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { buildRefineRequest, parseRefineOutput } from '../lib/refine.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string', default: 'background' },
    mask: { type: 'string' },
    models: { type: 'string', default: 'gpt-5.6-luna,gpt-5.6-terra' },
  },
});
const [file, prompt] = positionals;
if (!file || !prompt) throw new Error('사진 경로와 프롬프트를 넘기세요');

const img = sharp(file).rotate().resize(1024, 1024, { fit: 'inside' });
const { info } = await img.clone().toBuffer({ resolveWithObject: true });
const jpg = await img.jpeg({ quality: 85 }).toBuffer();
const mask = values.mask
  ? await sharp(values.mask).resize(info.width, info.height, { fit: 'fill' }).png().toBuffer()
  : await sharp({ create: { width: info.width, height: info.height, channels: 3, background: '#fff' } }).png().toBuffer();
const url = (buf, type) => `data:${type};base64,${buf.toString('base64')}`;

for (const model of values.models.split(',').map((m) => m.trim())) {
  const t = Date.now();
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRefineRequest(model, values.target, prompt, url(jpg, 'image/jpeg'), url(mask, 'image/png'))),
  });
  const json = await res.json();
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  if (!res.ok) { console.log(`[${model}] ${res.status} ${sec}s ${JSON.stringify(json).slice(0, 300)}`); continue; }
  console.log(`\n[${model}] ${sec}s usage in=${json.usage?.input_tokens} out=${json.usage?.output_tokens}\n${parseRefineOutput(json)}`);
}
