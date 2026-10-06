import type { Target } from './canvas';
import { MAX_PROMPT_CHARS } from './limits';

const MASK_RULE = 'Edit ONLY the transparent (masked) area of the image and keep everything else exactly as it is.';
const RULES =
  "Match the original photo's lighting, color temperature, perspective, lens character and film grain. " +
  'Do not add any text, logos, signatures or watermarks.';
const ALL =
  "Apply the requested change to the whole photo. Keep the people's identity, faces, pose and the overall composition, " +
  'and keep every element the request does not name.';
// "새 배경"으로 쓰면 모델이 배경 교체로 받아들여 요청 밖 요소까지 다시 그린다
const BACKGROUND =
  'Apply only the requested change to the background. Keep every existing background element ' +
  '(structures, plants, ground, sky) unchanged unless the request explicitly names it. ' +
  'Do not alter the person. Match the original lighting direction, color temperature and depth of field.';
const REFERENCES =
  'The first image is the photo to edit. The other images are references only: borrow the look of the requested ' +
  'content from them (species, color, shape, texture), but do not copy their composition, people or background.';
const PERSON = 'Change the person as requested. Keep their identity, pose and the surrounding scene unchanged.';
const EXPAND = 'The canvas has been extended: fill the newly added empty area by naturally continuing the original scene.';

/** 전체 편집은 마스크 없이 보낸다. 배경 전체를 연 마스크가 오히려 장면을 새로 그리게 만들었다 */
export const isWholeEdit = (target: Target, userPrompt: string) => target === 'all' && !!userPrompt.trim();

export function buildPrompt(target: Target, userPrompt: string, expanded: boolean, references = 0): string {
  const parts = isWholeEdit(target, userPrompt) ? [ALL, RULES] : [MASK_RULE, RULES];
  if (target === 'background') parts.push(BACKGROUND);
  if (target === 'person') parts.push(PERSON);
  if (expanded) parts.push(EXPAND);
  if (references > 0) parts.push(REFERENCES);
  const u = userPrompt.trim();
  if (u) parts.push(`User request: ${u}`);
  return parts.join('\n');
}

export function promptError(target: Target, userPrompt: string, expanded: boolean): string | null {
  if (userPrompt.length > MAX_PROMPT_CHARS) return `프롬프트는 ${MAX_PROMPT_CHARS}자 이하로 입력하세요.`;
  if (target !== 'all' && !userPrompt.trim()) return '수정 내용을 입력하세요.';
  if (target === 'all' && !expanded && !userPrompt.trim()) return '수정할 영역이 없어요.';
  return null;
}
