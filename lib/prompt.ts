import type { Target } from './canvas';
import { MAX_PROMPT_CHARS } from './limits';

const RULES =
  "Edit ONLY the transparent (masked) area of the image and keep everything else exactly as it is. " +
  "Match the original photo's lighting, color temperature, perspective, lens character and film grain. " +
  'Do not add any text, logos, signatures or watermarks.';
const BACKGROUND =
  "Change the background as requested. Do not alter the person. Make the new background match the person's lighting direction and color temperature.";
const PERSON = 'Change the person as requested. Keep their identity, pose and the surrounding scene unchanged.';
const EXPAND = 'The canvas has been extended: fill the newly added empty area by naturally continuing the original scene.';

export function buildPrompt(target: Target, userPrompt: string, expanded: boolean): string {
  const parts = [RULES];
  if (target === 'background') parts.push(BACKGROUND);
  if (target === 'person') parts.push(PERSON);
  if (expanded) parts.push(EXPAND);
  const u = userPrompt.trim();
  if (u) parts.push(`User request: ${u}`);
  return parts.join('\n');
}

export function promptError(target: Target, userPrompt: string, expanded: boolean): string | null {
  if (userPrompt.length > MAX_PROMPT_CHARS) return `프롬프트는 ${MAX_PROMPT_CHARS}자 이하로 입력하세요.`;
  if (target !== 'none' && !userPrompt.trim()) return '수정 내용을 입력하세요.';
  if (target === 'none' && !expanded) return '수정할 영역이 없어요.';
  return null;
}
