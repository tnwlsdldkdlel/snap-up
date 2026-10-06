export const MAX_INPUT_PX = 40_000_000;
export const MAX_OUTPUT_PX = 60_000_000;
export const MAX_EXPAND_RATIO = 2;
export const MODEL_MAX_PX = 2560 * 1440; // 이 이상은 gpt-image-2 experimental
export const MODEL_MIN_PX = 655_360;
export const MAX_BODY_BYTES = 4_400_000; // Vercel 함수 본문 4.5MB 제한에 여유
export const MAX_PROMPT_CHARS = 2000;
export const SEGMENT_MAX_SIDE = 2048;
export const API_MASK_DILATE_PX = 32; // 모델 해상도 기준, 이음새를 이어 그릴 여유
export const MAX_VERSIONS = 10;
export const MAX_REFERENCES = 3;
export const REFERENCE_MAX_SIDE = 1024; // 본문 4.5MB 예산 안에 넣으려고 축소해 보낸다
// 첫 항목이 기본값. 2026-10-06 같은 사진 비교: 2는 가장 선명·118s, sunburst는 44s, flare는 32s지만 확대 시 뭉개짐
export const IMAGE_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2 (선명, 느림)' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst (균형)' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare (빠름)' },
] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number]['id'];
