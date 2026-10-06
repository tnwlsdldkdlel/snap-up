# CLAUDE.md

## 프로젝트

**snap-up** — 직접 찍은 스냅 사진을 프롬프트로 편집하는 개인용 웹 도구. 혼자 쓰며 Vercel에 배포해 URL로 사용한다.

- 배경 / 인물 선택 수정, 비율 변경(확장 시 AI outpainting, 크롭은 로컬), 결과 위 이어서 편집
- 설계: `docs/superpowers/specs/2026-10-06-snap-up-design.md` — 구현 전 반드시 읽을 것
- 상태: spec 확정, 다음은 구현 계획(writing-plans). 계획 첫 단계는 gpt-image-2 edits의 마스크 형식·지연·응답 크기 실측

## 스택

Next.js(App Router) + TypeScript, Vercel(Fluid compute, Node 런타임), Vitest.
AI: OpenAI `gpt-image-2`(images/edits), fal BiRefNet(세그멘테이션).
환경변수(서버 전용, `NEXT_PUBLIC_` 금지): `OPENAI_API_KEY`, `FAL_KEY`, `APP_PASSWORD`. `.env*`는 읽지 않는다.

## 절대 조건 (깨면 안 됨)

1. **지정 외 수정 금지**: 승인 영역 A 밖 픽셀은 기준 이미지와 차이 0px. 합성 가중치 `W = min(A, blur(A))`로 A 밖을 정확히 0으로 두고, 저장 PNG를 재디코딩해 검증한다. 검증 실패 시 채택·다운로드 차단.
2. **고화질 유지**: 원본 해상도로 합성하고 PNG로 저장. 원본은 브라우저 메모리에만 두고 업로드하지 않는다.
3. **워터마크 금지**: 보이는 워터마크·텍스트·로고 없음 + 메타데이터 없음(Canvas 재인코딩).

## 알아둘 제약

- Vercel 함수 요청·응답 본문 4.5MB 제한 → 모델 입력은 축소본(JPEG q0.92)만 보내고, `/api/edit` 응답은 OpenAI 본문을 그대로 스트리밍한다.
- gpt-image-2 size: 양 변 16의 배수, 총 픽셀 ≤ 2560×1440, 비율 ≤ 3:1. mask는 alpha 0 = 편집 영역이며 픽셀 잠금이 아니라 지침일 뿐이다(그래서 조건 1은 로컬 재합성으로 보장).
- 외부 API 자동 재시도 금지(비용). URL 입력을 받지 않는다(파일 바이트만).
- `APP_PASSWORD` 미설정 시 전 경로 차단(fail closed).

## 커밋·push

- 개인 프로젝트라 태스크 ID 없음. 제목은 `type: 요약` (type: feat·fix·refactor·style·docs·chore).
- 작성자: `OHsujin <67881808+tnwlsdldkdlel@users.noreply.github.com>` (로컬 git config에 설정됨). 회사 계정으로 커밋하지 않는다.
- 원격: `https://github.com/tnwlsdldkdlel/snap-up.git`, 브랜치 `main`.
- 커밋·push는 지시가 있을 때만, Claude attribution trailer 금지.
