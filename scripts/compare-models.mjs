// 같은 입력으로 이미지 모델을 비교한다. 결과는 probe-out/compare-<모델>-<시각>.png
// 실행: node --env-file=.env.local scripts/compare-models.mjs <photo> <prompt> [--mask m.png] [--ref r.jpg]... [--models a,b]
// mask는 API 형식(alpha 0 = 편집 영역). 없으면 마스크 없이 보낸다.
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mask: { type: 'string' },
    ref: { type: 'string', multiple: true, default: [] },
    models: { type: 'string', default: 'gpt-image-2,gpt-image-2.5-sunburst,gpt-image-2.5-flare' },
  },
});
const [file, prompt] = positionals;
if (!file || !prompt) throw new Error('사진 경로와 프롬프트를 넘기세요');
await fs.mkdir('probe-out', { recursive: true });

// 앱과 같은 규칙: 총 픽셀 ≤ 2560×1440, 양 변 16의 배수, JPEG q92
const { info } = await sharp(file).rotate().toBuffer({ resolveWithObject: true });
const s = Math.min(1, Math.sqrt((2560 * 1440) / (info.width * info.height)));
const W = Math.floor((info.width * s) / 16) * 16;
const H = Math.floor((info.height * s) / 16) * 16;
const image = await sharp(file).rotate().resize(W, H, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
const mask = values.mask ? await sharp(values.mask).resize(W, H, { fit: 'fill' }).ensureAlpha().png().toBuffer() : null;
const refs = await Promise.all(
  values.ref.map((r) => sharp(r).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 90 }).toBuffer()),
);
console.log(`입력 ${info.width}x${info.height} → ${W}x${H}, 레퍼런스 ${refs.length}장, 마스크 ${mask ? '있음' : '없음'}`);

async function edit(model) {
  const fd = new FormData();
  fd.append('model', model);
  fd.append('prompt', prompt);
  fd.append('size', `${W}x${H}`);
  fd.append('quality', 'high');
  fd.append('output_format', 'png');
  const field = refs.length ? 'image[]' : 'image';
  fd.append(field, new Blob([image], { type: 'image/jpeg' }), 'image.jpg');
  refs.forEach((r, i) => fd.append(field, new Blob([r], { type: 'image/jpeg' }), `reference-${i + 1}.jpg`));
  if (mask) fd.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
  const t = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  if (!res.ok) return console.log(`[${model}] ${res.status} ${sec}s ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  const out = Buffer.from(json.data[0].b64_json, 'base64');
  const meta = await sharp(out).metadata();
  // 열려 있는(잠긴) 이전 결과를 덮어쓰다 실패하지 않게 시각을 붙인다
  const path = `probe-out/compare-${model}-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.png`;
  await fs.writeFile(path, out);
  console.log(`[${model}] ${path} ${sec}s, 출력 ${meta.width}x${meta.height}, usage ${JSON.stringify(json.usage ?? {})}`);
}

// 비용 때문에 재시도 없이 순서대로 1회씩
for (const m of values.models.split(',')) await edit(m.trim());
