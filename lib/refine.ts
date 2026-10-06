// 앱(route)과 실험 스크립트가 함께 쓰므로 다른 모듈을 import하지 않는다
export const REFINE_MODEL = 'gpt-5.6-terra';
export const REFINE_MAX_CHARS = 600;

type RefineTarget = 'all' | 'background' | 'person';

const TARGET_DESC: Record<RefineTarget, string> = {
  background: '인물을 제외한 배경',
  person: '인물',
  all: '사진 전체',
};

export const REFINE_INSTRUCTIONS = [
  '너는 사진 부분 편집용 이미지 모델에 넣을 지시문을 다듬는다.',
  '첫 번째 이미지는 편집할 사진, 두 번째 이미지는 편집 가능 영역 마스크(흰색 = 편집 가능)다.',
  '사용자 요청의 의도만 구체화한다: 무엇을, 사진 속 어느 대상에, 얼마나(밀도·크기·개수), 어떤 모습으로.',
  '사진에서 실제로 보이는 대상의 특징(재질·형태·위치·빛 방향)을 짚어 지시를 사진에 고정한다.',
  '사용자가 말하지 않은 요소나 장식을 추가하지 않는다. 애매하면 절제된 쪽(적게, 자연스럽게)을 고른다.',
  '바꾸지 말아야 할 주변 요소(하늘·바닥·나무·구조물 등 요청에 없는 것)를 명시한다.',
  `한국어 평문으로 ${REFINE_MAX_CHARS}자 이내, 지시문만 출력한다. 머리말·따옴표·마크다운 없이.`,
].join('\n');

export function refineUserText(target: RefineTarget, userPrompt: string): string {
  return `편집 대상: ${TARGET_DESC[target]}\n사용자 요청: ${userPrompt.trim()}`;
}

/** Responses API 본문. 이미지는 data URL로 넣는다 */
export function buildRefineRequest(model: string, target: RefineTarget, userPrompt: string, imageDataUrl: string, maskDataUrl: string) {
  return {
    model,
    instructions: REFINE_INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: refineUserText(target, userPrompt) },
          { type: 'input_image', image_url: imageDataUrl },
          { type: 'input_image', image_url: maskDataUrl },
        ],
      },
    ],
  };
}

/** Responses API 응답에서 텍스트만 뽑는다. 없거나 비면 null */
export function parseRefineOutput(json: unknown): string | null {
  const output = (json as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] })?.output;
  if (!Array.isArray(output)) return null;
  const text = output
    .filter((o) => o?.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('')
    .trim();
  return text ? text.slice(0, REFINE_MAX_CHARS) : null;
}
