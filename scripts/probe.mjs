// 실행: node --env-file=.env.local scripts/probe.mjs <photo.jpg>
import fs from 'node:fs/promises';
import sharp from 'sharp';

const file = process.argv[2];
if (!file) throw new Error('사진 경로를 넘기세요');
await fs.mkdir('probe-out', { recursive: true });

const { info } = await sharp(file).rotate().toBuffer({ resolveWithObject: true });
const s = Math.sqrt((2560 * 1440) / (info.width * info.height));
const W = Math.floor((info.width * s) / 16) * 16;
const H = Math.floor((info.height * s) / 16) * 16;
console.log('원본', info.width, info.height, '→ 모델', W, H);

const rgb = sharp(file).rotate().resize(W, H, { fit: 'fill' });
const jpg = await rgb.clone().jpeg({ quality: 92 }).toBuffer();
const png = await rgb.clone().png().toBuffer();

// 가운데 1/2 영역만 편집(alpha 0), 나머지 보호(alpha 255)
const raw = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const inside = x > W / 4 && x < (3 * W) / 4 && y > H / 4 && y < (3 * H) / 4;
    raw[(y * W + x) * 4 + 3] = inside ? 0 : 255;
  }
const mask = await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
console.log('바이트: jpg', jpg.length, 'png', png.length, 'mask', mask.length);

async function edit(label, image, type) {
  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  fd.append('prompt', 'Replace only the transparent masked area with a bouquet of white flowers. Do not add text or watermarks.');
  fd.append('size', `${W}x${H}`);
  fd.append('quality', 'high');
  fd.append('output_format', 'png');
  fd.append('image', new Blob([image], { type }), type === 'image/png' ? 'image.png' : 'image.jpg');
  fd.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
  const t = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  console.log(`[${label}] status ${res.status}, ${Date.now() - t}ms, 응답 ${text.length} bytes`);
  if (!res.ok) return console.log(text.slice(0, 500));
  const out = Buffer.from(JSON.parse(text).data[0].b64_json, 'base64');
  const meta = await sharp(out).metadata();
  console.log(`[${label}] 출력 ${meta.width}x${meta.height}, 출력 PNG ${out.length} bytes`);
  await fs.writeFile(`probe-out/${label}.png`, out);
  // 마스크 밖 변화량(정보용): 모델이 보호 영역도 다시 그리는지 확인
  const a = await sharp(png).raw().toBuffer();
  const b = await sharp(out).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (raw[(y * W + x) * 4 + 3] === 0) continue;
      const i = (y * W + x) * 3;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  console.log(`[${label}] 마스크 밖 평균 채널 차이 ${(sum / n).toFixed(2)}`);
}

await edit('jpeg-image', jpg, 'image/jpeg');
await edit('png-image', png, 'image/png');
