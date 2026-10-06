import { fitModelSize, type Frame, type Target } from './canvas';
import { compositeInto, countProtectedDiff, embedRGBA, type RGBA } from './composite';
import { API_MASK_DILATE_PX, MAX_BODY_BYTES, SEGMENT_MAX_SIDE } from './limits';
import { any, assemble, buildEditMask, resizeBilinear, toApiMaskRGBA, type Brush, type Mask } from './mask';
import { userMessage } from './upstream';
import { base64ToBlob, decodeFile, encode, resizeRGBA } from './browser';

async function failMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return userMessage(res.status, body);
}

/** 인물 마스크(기준 해상도, 인물=255). 분할은 브라우저에서 하며 모델은 첫 호출 때 내려받는다. */
export async function segment(base: RGBA): Promise<Mask> {
  const k = Math.min(1, SEGMENT_MAX_SIDE / Math.max(base.w, base.h));
  const sw = Math.round(base.w * k), sh = Math.round(base.h * k);
  const { segmentRGBA } = await import('./segment');
  return resizeBilinear(await segmentRGBA(resizeRGBA(base, sw, sh)), sw, sh, base.w, base.h);
}

export type GenerateInput = { base: RGBA; frame: Frame; target: Target; prompt: string; seg: Mask | null; brush: Brush | null };
export type GenerateResult = { out: RGBA; blob: Blob; protectedDiff: number; usedAI: boolean };

export async function generate(input: GenerateInput, onStage: (s: string) => void): Promise<GenerateResult> {
  const { base, frame } = input;
  const expanded = frame.cw > base.w || frame.ch > base.h;
  const edit = buildEditMask(input.target, input.seg, input.brush, base);
  const featherPx = Math.max(2, Math.round(Math.max(frame.cw, frame.ch) / 1000));
  const { approved, weight } = assemble(edit, base, frame, featherPx);
  const baseCanvas = embedRGBA(base, frame);

  if (!any(approved)) {
    // 편집·확장 없음(크롭만): AI 없이 로컬 처리
    return { out: baseCanvas, blob: await encode(baseCanvas, 'image/png'), protectedDiff: 0, usedAI: false };
  }

  onStage('AI 요청 준비 중');
  const ms = fitModelSize(frame.cw, frame.ch);
  const image = await encode(resizeRGBA(baseCanvas, ms.w, ms.h), 'image/jpeg', 0.92);
  const maskRGBA = toApiMaskRGBA(resizeBilinear(approved, frame.cw, frame.ch, ms.w, ms.h), ms.w, ms.h, API_MASK_DILATE_PX);
  const mask = await encode({ w: ms.w, h: ms.h, data: maskRGBA }, 'image/png');
  if (image.size + mask.size > MAX_BODY_BYTES) throw new Error('요청이 너무 커요. 다른 비율을 고르세요.');

  const fd = new FormData();
  fd.append('image', image, 'image.jpg');
  fd.append('mask', mask, 'mask.png');
  fd.append('size', `${ms.w}x${ms.h}`);
  fd.append('target', input.target);
  fd.append('prompt', input.prompt);
  fd.append('expanded', expanded ? '1' : '0');

  onStage('AI 생성 중 (1~2분)');
  const res = await fetch('/api/edit', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(await failMessage(res));
  const b64: unknown = (await res.json())?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string') throw new Error('AI 응답에 이미지가 없어요. 다시 시도하세요.');

  onStage('합성·검증 중');
  const ai = resizeRGBA(await decodeFile(base64ToBlob(b64, 'image/png')), frame.cw, frame.ch);
  const out: RGBA = { w: frame.cw, h: frame.ch, data: compositeInto(ai.data, baseCanvas.data, weight) as Uint8ClampedArray<ArrayBuffer> };
  const blob = await encode(out, 'image/png');
  const check = await decodeFile(blob);
  return { out, blob, protectedDiff: countProtectedDiff(baseCanvas.data, check.data, weight), usedAI: true };
}
