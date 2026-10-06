import { MAX_EXPAND_RATIO, MAX_OUTPUT_PX, MODEL_MAX_PX, MODEL_MIN_PX } from './limits';

export type Size = { w: number; h: number };
export type Mode = 'expand' | 'crop';
export type Target = 'background' | 'person' | 'none';
/** 출력 캔버스 크기와 그 안에 기준 이미지를 그릴 위치. crop이면 오프셋이 음수다. */
export type Frame = { cw: number; ch: number; ox: number; oy: number };

export const RATIO_PRESETS: { label: string; ratio: number | null }[] = [
  { label: '원본', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
];

export function planFrame(base: Size, ratio: number | null, mode: Mode, anchor = { x: 0.5, y: 0.5 }): Frame {
  const { w, h } = base;
  if (ratio === null) return { cw: w, ch: h, ox: 0, oy: 0 };
  const wider = ratio > w / h;
  let cw: number;
  let ch: number;
  if (mode === 'expand') [cw, ch] = wider ? [Math.round(h * ratio), h] : [w, Math.round(w / ratio)];
  else [cw, ch] = wider ? [w, Math.round(w / ratio)] : [Math.round(h * ratio), h];
  return { cw, ch, ox: Math.round((cw - w) * anchor.x), oy: Math.round((ch - h) * anchor.y) };
}

export function checkFrame(base: Size, f: Frame): string | null {
  if (f.cw * f.ch > MAX_OUTPUT_PX) return '출력이 60MP를 넘어요. 다른 비율을 고르세요.';
  if (f.cw * f.ch > base.w * base.h * MAX_EXPAND_RATIO) return '확장 면적이 원본의 2배를 넘어요.';
  return null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function anchorFromOffset(base: Size, f: Frame, ox: number, oy: number) {
  const sx = f.cw - base.w;
  const sy = f.ch - base.h;
  return { x: sx === 0 ? 0.5 : clamp01(ox / sx), y: sy === 0 ? 0.5 : clamp01(oy / sy) };
}

/** 비율을 유지하며 총 픽셀을 모델 상한 근처로 맞춘다. 비율 3:1 이하는 호출자(프리셋)가 보장. */
export function fitModelSize(w: number, h: number): Size {
  const s = Math.sqrt(MODEL_MAX_PX / (w * h));
  return { w: Math.floor((w * s) / 16) * 16, h: Math.floor((h * s) / 16) * 16 };
}

export function isValidModelSize(w: number, h: number): boolean {
  const px = w * h;
  return (
    w % 16 === 0 && h % 16 === 0 &&
    px <= MODEL_MAX_PX && px >= MODEL_MIN_PX &&
    Math.max(w, h) <= 3840 && Math.max(w / h, h / w) <= 3
  );
}
