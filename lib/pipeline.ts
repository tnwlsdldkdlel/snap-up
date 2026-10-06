import { fitModelSize, type Frame, type Target } from './canvas';
import { compositeInto, countProtectedDiff, embedRGBA, type RGBA } from './composite';
import { type ImageModel, API_MASK_DILATE_PX, MAX_BODY_BYTES, REFERENCE_MAX_SIDE, SEGMENT_MAX_SIDE } from './limits';
import { any, assemble, buildEditMask, resizeBilinear, snapMatte, toApiMaskRGBA, type Brush, type Mask } from './mask';
import { isWholeEdit } from './prompt';
import { userMessage } from './upstream';
import { base64ToBlob, decodeFile, encode, resizeRGBA } from './browser';

async function failMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return userMessage(res.status, body);
}

/** 인물 마스크(기준 해상도, 인물=255). 분할은 브라우저에서 하며 모델은 첫 호출 때 내려받는다. */
export async function segment(base: RGBA, onStage?: (s: string) => void): Promise<Mask> {
  const k = Math.min(1, SEGMENT_MAX_SIDE / Math.max(base.w, base.h));
  const sw = Math.round(base.w * k), sh = Math.round(base.h * k);
  const { segmentRGBA } = await import('./segment');
  return snapMatte(resizeBilinear(await segmentRGBA(resizeRGBA(base, sw, sh), onStage), sw, sh, base.w, base.h));
}

/** 레퍼런스 이미지를 긴 변 REFERENCE_MAX_SIDE 이하 JPEG로 줄인다. 재인코딩이라 메타데이터도 빠진다 */
export async function prepareReference(file: Blob): Promise<Blob> {
  const img = await decodeFile(file);
  const k = Math.min(1, REFERENCE_MAX_SIDE / Math.max(img.w, img.h));
  return encode(resizeRGBA(img, Math.round(img.w * k), Math.round(img.h * k)), 'image/jpeg', 0.9);
}

/** 생성 단계. 진행 오버레이가 이 순서로 단계를 그린다 */
export const GENERATE_STEPS = ['사진 준비 중', 'AI가 이미지를 그리는 중', '원본과 합성·검증 중'] as const;
export const GENERATE_STEP_LABELS = ['준비', 'AI 생성', '합성·검증'] as const;

export type GenerateInput = {
  base: RGBA; frame: Frame; target: Target; prompt: string; seg: Mask | null; brush: Brush | null; references?: Blob[]; model?: ImageModel;
};
/** raw: 합성 없이 AI 출력을 프레임 크기로 늘린 것. 인물까지 다시 그려져 자연스럽지만 보호 영역이 보존되지 않는다 */
export type GenerateResult = { out: RGBA; blob: Blob; protectedDiff: number; usedAI: boolean; raw?: { out: RGBA; blob: Blob } };

const REFINE_SIDE = 1024;

/** 사진과 편집 영역(흰색 = 편집 가능)을 함께 보내 프롬프트를 다듬는다. 생성은 하지 않는다 */
export async function refinePrompt(input: Omit<GenerateInput, 'references' | 'model'>): Promise<string> {
  const { base, frame } = input;
  const edit = editMask(input);
  const { approved } = assemble(edit, base, frame, 0);
  const k = Math.min(1, REFINE_SIDE / Math.max(frame.cw, frame.ch));
  const w = Math.round(frame.cw * k), h = Math.round(frame.ch * k);
  const image = await encode(resizeRGBA(embedRGBA(base, frame), w, h), 'image/jpeg', 0.85);
  const small = resizeBilinear(approved, frame.cw, frame.ch, w, h);
  const maskRGBA = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < small.length; i++) maskRGBA.fill(small[i], i * 4, i * 4 + 3), (maskRGBA[i * 4 + 3] = 255);
  const mask = await encode({ w, h, data: maskRGBA }, 'image/png');

  const fd = new FormData();
  fd.append('image', image, 'image.jpg');
  fd.append('mask', mask, 'mask.png');
  fd.append('target', input.target);
  fd.append('prompt', input.prompt);
  const res = await fetch('/api/refine', { method: 'POST', body: fd }).catch(() => {
    throw new Error('네트워크 오류로 요청하지 못했어요. 다시 시도하세요.');
  });
  if (!res.ok) throw new Error(await failMessage(res));
  const json: any = await res.json().catch(() => null);
  if (typeof json?.prompt !== 'string') throw new Error('다듬은 프롬프트를 받지 못했어요. 다시 시도하세요.');
  return json.prompt;
}

/** 전체 편집이면 사진 전체가 편집 영역이다 */
function editMask(input: Pick<GenerateInput, 'base' | 'target' | 'prompt' | 'seg' | 'brush'>): Mask | null {
  if (isWholeEdit(input.target, input.prompt)) return new Uint8Array(input.base.w * input.base.h).fill(255);
  return buildEditMask(input.target, input.seg, input.brush, input.base);
}

export async function generate(input: GenerateInput, onStage: (s: string) => void): Promise<GenerateResult> {
  const { base, frame } = input;
  const expanded = frame.cw > base.w || frame.ch > base.h;
  const edit = editMask(input);
  const featherPx = Math.max(2, Math.round(Math.max(frame.cw, frame.ch) / 1000));
  const { approved, weight } = assemble(edit, base, frame, featherPx);
  const baseCanvas = embedRGBA(base, frame);

  const whole = isWholeEdit(input.target, input.prompt);
  if (input.target !== 'all' && !expanded && !any(edit ?? new Uint8Array(0))) {
    throw new Error('수정할 영역이 없어요. 브러시로 칠하세요.');
  }
  if (!any(approved)) {
    // 편집·확장 없음(크롭만): AI 없이 로컬 처리. weight가 0이라 전 픽셀이 보호 대상
    return { ...(await encodeAndVerify(baseCanvas, baseCanvas, weight)), usedAI: false };
  }

  onStage(GENERATE_STEPS[0]);
  const ms = fitModelSize(frame.cw, frame.ch);
  const image = await encode(resizeRGBA(baseCanvas, ms.w, ms.h), 'image/jpeg', 0.92);
  const maskRGBA = toApiMaskRGBA(resizeBilinear(approved, frame.cw, frame.ch, ms.w, ms.h), ms.w, ms.h, API_MASK_DILATE_PX);
  const mask = await encode({ w: ms.w, h: ms.h, data: maskRGBA }, 'image/png');
  const refs = input.references ?? [];
  if (image.size + (whole ? 0 : mask.size) + refs.reduce((n, r) => n + r.size, 0) > MAX_BODY_BYTES) {
    throw new Error(refs.length ? '요청이 너무 커요. 레퍼런스를 줄이거나 다른 비율을 고르세요.' : '요청이 너무 커요. 다른 비율을 고르세요.');
  }

  const fd = new FormData();
  fd.append('image', image, 'image.jpg');
  if (!whole) fd.append('mask', mask, 'mask.png');
  fd.append('size', `${ms.w}x${ms.h}`);
  fd.append('target', input.target);
  fd.append('prompt', input.prompt);
  fd.append('expanded', expanded ? '1' : '0');
  if (input.model) fd.append('model', input.model);
  refs.forEach((r, i) => fd.append('reference', r, `reference-${i + 1}.jpg`));

  onStage(GENERATE_STEPS[1]);
  const res = await fetch('/api/edit', { method: 'POST', body: fd }).catch(() => {
    throw new Error('네트워크 오류로 요청하지 못했어요. 다시 시도하세요.');
  });
  if (!res.ok) throw new Error(await failMessage(res));
  const unreadable = () => new Error('AI 응답을 읽지 못했어요. 다시 시도하세요.');
  const json: any = await res.json().catch(() => { throw unreadable(); });
  const b64: unknown = json?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string') throw new Error('AI 응답에 이미지가 없어요. 다시 시도하세요.');

  onStage(GENERATE_STEPS[2]);
  let decoded: RGBA;
  try {
    decoded = await decodeFile(base64ToBlob(b64, 'image/png'));
  } catch {
    throw unreadable();
  }
  const ai = resizeRGBA(decoded, frame.cw, frame.ch);
  const out: RGBA = { w: frame.cw, h: frame.ch, data: compositeInto(ai.data, baseCanvas.data, weight) as Uint8ClampedArray<ArrayBuffer> };
  // 전체 편집은 합성본이 곧 AI 출력이라 raw를 따로 만들지 않는다
  if (whole) return { ...(await encodeAndVerify(out, baseCanvas, weight)), usedAI: true };
  const [verified, rawBlob] = await Promise.all([encodeAndVerify(out, baseCanvas, weight), encode(ai, 'image/png')]);
  return { ...verified, usedAI: true, raw: { out: ai, blob: rawBlob } };
}

/** PNG로 저장한 뒤 재디코딩해 보호 영역 차이를 센다. */
async function encodeAndVerify(out: RGBA, baseCanvas: RGBA, weight: Mask) {
  const blob = await encode(out, 'image/png');
  const check = await decodeFile(blob);
  return { out, blob, protectedDiff: countProtectedDiff(baseCanvas.data, check.data, weight) };
}
