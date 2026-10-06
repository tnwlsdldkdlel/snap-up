'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Callout, Card, Flex, IconButton, Select, SegmentedControl, Slider, Text, TextArea } from '@radix-ui/themes';
import Stage, { type Tool } from '../components/Stage';
import { RATIO_PRESETS, anchorFromOffset, checkFrame, planFrame, type Mode, type Size, type Target } from '../lib/canvas';
import type { RGBA } from '../lib/composite';
import { IMAGE_MODELS, MAX_INPUT_PX, MAX_REFERENCES, MAX_VERSIONS, type ImageModel } from '../lib/limits';
import { BRUSH_NONE, buildEditMask, paintBrush, resizeBilinear, type Mask } from '../lib/mask';
import { promptError } from '../lib/prompt';
import { decodeFile, rgbaToCanvas } from '../lib/browser';
import { generate, prepareReference, refinePrompt, segment, type GenerateResult } from '../lib/pipeline';

type Version = { blob: Blob; url: string };
type Result = GenerateResult & { url: string; rawUrl?: string };
type Variant = 'composite' | 'raw';

const revokeResult = (r: Result) => {
  URL.revokeObjectURL(r.url);
  if (r.rawUrl) URL.revokeObjectURL(r.rawUrl);
};
const PREVIEW_SIDE = 1600;
const BRUSH_SIDE = 1024;

const scaled = (s: Size, side: number): Size => {
  const k = Math.min(1, side / Math.max(s.w, s.h));
  return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="2">
      <Text as="div" size="2" weight="medium">{title}</Text>
      {children}
    </Flex>
  );
}

export default function Page() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [current, setCurrent] = useState(0);
  const [base, setBase] = useState<RGBA | null>(null);
  const [preview, setPreview] = useState<ImageBitmap | null>(null);
  const [target, setTarget] = useState<Target>('all');
  const [prompt, setPrompt] = useState('');
  const [promptBeforeRefine, setPromptBeforeRefine] = useState<string | null>(null);
  const [ratioIdx, setRatioIdx] = useState(0);
  const [mode, setMode] = useState<Mode>('expand');
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 });
  const [seg, setSeg] = useState<Mask | null>(null);
  const [segSmall, setSegSmall] = useState<Mask | null>(null);
  const brush = useRef<Mask>(new Uint8Array(0));
  const [brushTick, setBrushTick] = useState(0);
  const [tool, setTool] = useState<Tool>('move');
  const [brushPx, setBrushPx] = useState(30);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [holdOriginal, setHoldOriginal] = useState(false);
  const [variant, setVariant] = useState<Variant>('composite');
  const [references, setReferences] = useState<Version[]>([]);
  const [model, setModel] = useState<ImageModel>(IMAGE_MODELS[0].id);

  const bs = base ? scaled(base, BRUSH_SIDE) : null;
  // 원본 보존(합성)은 보호 영역 검증을 통과해야 쓸 수 있고, AI 결과 그대로는 검증 대상이 아니다
  const shown = result && (variant === 'raw' && result.raw && result.rawUrl
    ? { out: result.raw.out, blob: result.raw.blob, url: result.rawUrl, ok: true }
    : { out: result.out, blob: result.blob, url: result.url, ok: result.protectedDiff === 0 });
  const ratio = RATIO_PRESETS[ratioIdx].ratio;
  const frame = base ? planFrame(base, ratio, mode, anchor) : null;
  const frameErr = base && frame ? checkFrame(base, frame) : null;
  const expanded = !!(base && frame && (frame.cw > base.w || frame.ch > base.h));
  const nothingToDo = target === 'all' && ratio === null && !prompt.trim();
  const pErr = target === 'all' && !expanded && !prompt.trim() ? null : promptError(target, prompt, expanded);

  useEffect(() => {
    if (versions.length < 2 && !result) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [versions.length, result]);

  useEffect(() => () => preview?.close(), [preview]);

  const overlay = useMemo(() => {
    if (!bs || target === 'all') return null;
    const m = buildEditMask(target, segSmall, { mask: brush.current, w: bs.w, h: bs.h }, bs)!;
    const img = new ImageData(bs.w, bs.h);
    for (let i = 0; i < m.length; i++) {
      img.data[i * 4] = 235;
      img.data[i * 4 + 1] = 64;
      img.data[i * 4 + 2] = 52;
      img.data[i * 4 + 3] = Math.round(m[i] * 0.45);
    }
    return img;
    // brushTick: 브러시 레이어(ref) 변경 신호
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, segSmall, brushTick, bs?.w, bs?.h]);

  async function applyBase(img: RGBA) {
    const p = scaled(img, PREVIEW_SIDE);
    setPreview(await createImageBitmap(rgbaToCanvas(img), { resizeWidth: p.w, resizeHeight: p.h, resizeQuality: 'high' }));
    setBase(img);
    setSeg(null);
    setSegSmall(null);
    setTarget('all');
    setTool('move');
    setRatioIdx(0);
    setAnchor({ x: 0.5, y: 0.5 });
    const b = scaled(img, BRUSH_SIDE);
    brush.current = new Uint8Array(b.w * b.h).fill(BRUSH_NONE);
    setBrushTick((t) => t + 1);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy('불러오는 중');
    try {
      const img = await decodeFile(file);
      if (img.w * img.h > MAX_INPUT_PX) throw new Error('40MP 이하 사진만 지원해요.');
      await applyBase(img);
      versions.forEach((v) => URL.revokeObjectURL(v.url));
      if (result) revokeResult(result);
      setResult(null);
      setVersions([{ blob: file, url: URL.createObjectURL(file) }]);
      setCurrent(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 열 수 없어요.');
    } finally {
      setBusy('');
    }
  }

  async function addReferences(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, MAX_REFERENCES - references.length);
    if (!picked.length) return;
    setError('');
    setBusy('레퍼런스 준비 중');
    try {
      const blobs = await Promise.all(picked.map(prepareReference));
      setReferences((rs) => [...rs, ...blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))]);
    } catch {
      setError('레퍼런스 이미지를 열 수 없어요.');
    } finally {
      setBusy('');
    }
  }

  function removeReference(i: number) {
    URL.revokeObjectURL(references[i].url);
    setReferences((rs) => rs.filter((_, j) => j !== i));
  }

  async function chooseTarget(t: Target) {
    setTarget(t);
    setTool(t === 'all' ? 'move' : tool);
    if (t === 'all' || seg || !base || !bs) return;
    setError('');
    setBusy('인물 인식 중');
    try {
      const m = await segment(base, setBusy);
      setSeg(m);
      setSegSmall(resizeBilinear(m, base.w, base.h, bs.w, bs.h));
    } catch (e) {
      console.error('[segment] 자동 인식 실패', e);
      setError('자동 인식에 실패했어요. 브러시로 칠해서 진행하세요.');
    } finally {
      setBusy('');
    }
  }

  async function refine() {
    if (!base || !frame || !bs) return;
    setError('');
    setBusy('프롬프트 다듬는 중');
    try {
      const brushInput = target === 'all' ? null : { mask: brush.current, w: bs.w, h: bs.h };
      const refined = await refinePrompt({ base, frame, target, prompt, seg, brush: brushInput });
      setPromptBeforeRefine(prompt);
      setPrompt(refined);
    } catch (e) {
      setError(e instanceof Error ? e.message : '프롬프트를 다듬지 못했어요.');
    } finally {
      setBusy('');
    }
  }

  async function run() {
    if (!base || !frame || !bs) return;
    setError('');
    setBusy('준비 중');
    try {
      const r = await generate(
        {
          base, frame, target, prompt, seg,
          brush: target === 'all' ? null : { mask: brush.current, w: bs.w, h: bs.h },
          references: references.map((r) => r.blob),
          model,
        },
        setBusy,
      );
      setResult({ ...r, url: URL.createObjectURL(r.blob), rawUrl: r.raw && URL.createObjectURL(r.raw.blob) });
      setVariant('composite');
    } catch (e) {
      setError(e instanceof Error ? e.message : '생성에 실패했어요.');
    } finally {
      setBusy('');
    }
  }

  async function adopt() {
    if (!result || !shown?.ok) return;
    setError('');
    setBusy('불러오는 중');
    try {
      await applyBase(shown.out);
      // 고르지 않은 쪽 URL만 해제하고, 고른 쪽은 버전으로 남긴다
      [result.url, result.rawUrl].forEach((u) => u && u !== shown.url && URL.revokeObjectURL(u));
      const next = [...versions, { blob: shown.blob, url: shown.url }];
      if (next.length > MAX_VERSIONS) URL.revokeObjectURL(next.splice(1, 1)[0].url);
      setVersions(next);
      setCurrent(next.length - 1);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '채택에 실패했어요.');
    } finally {
      setBusy('');
    }
  }

  function discard() {
    if (result) revokeResult(result);
    setResult(null);
  }

  async function selectVersion(i: number) {
    setError('');
    setBusy('불러오는 중');
    try {
      await applyBase(await decodeFile(versions[i].blob));
      setCurrent(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : '버전을 열 수 없어요.');
    } finally {
      setBusy('');
    }
  }

  const locked = !!busy || !!result;

  return (
    <main className="app">
      <section className="stage">
        {!base && (
          <label className="drop">
            사진을 선택하거나 여기로 끌어다 놓으세요
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        )}
        {base && preview && frame && !result && (
          <Stage
            preview={preview}
            base={base}
            frame={frame}
            overlay={overlay}
            tool={tool}
            brushPx={brushPx}
            onMove={(ox, oy) => setAnchor(anchorFromOffset(base, frame, ox, oy))}
            onPaint={(nx, ny, nr, add) => {
              if (!bs) return;
              paintBrush(brush.current, bs.w, bs.h, nx * bs.w, ny * bs.h, nr * bs.w, add);
              setBrushTick((t) => t + 1);
            }}
          />
        )}
        {result && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="result" src={holdOriginal ? versions[current].url : shown!.url} alt={holdOriginal ? '편집 전' : '편집 결과'} />
        )}
        {versions.length > 0 && (
          <ol className="versions" aria-label="버전">
            {versions.map((v, i) => (
              <li key={v.url}>
                <button type="button" aria-current={i === current} disabled={locked} onClick={() => selectVersion(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.url} alt={i === 0 ? '원본' : `버전 ${i}`} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="panel">
        <Card size="2">
          <Flex direction="column" gap="4">
            <Button asChild variant="soft" disabled={!!busy}>
              <label>
                새 사진
                <input type="file" accept="image/*" hidden disabled={!!busy} onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </Button>

            <Section title="수정 대상">
              <SegmentedControl.Root value={target} disabled={!base || locked} onValueChange={(v) => chooseTarget(v as Target)}>
                <SegmentedControl.Item value="all">AI 전체</SegmentedControl.Item>
                <SegmentedControl.Item value="background">배경</SegmentedControl.Item>
                <SegmentedControl.Item value="person">인물</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Section>

            <Section title="프롬프트">
              <TextArea
                aria-label="프롬프트"
                value={prompt}
                maxLength={2000}
                rows={8}
                resize="vertical"
                disabled={!base || locked}
                placeholder={target === 'all' ? '예: 사진 전체를 노을 지는 분위기로 (비우면 비율만 바꿔요)' : '예: 배경을 해 질 녘 바닷가로'}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <Flex gap="2">
                <Button variant="soft" disabled={!base || locked || !prompt.trim()} onClick={refine}>AI로 다듬기</Button>
                {promptBeforeRefine !== null && (
                  <Button variant="ghost" color="gray" disabled={locked} onClick={() => { setPrompt(promptBeforeRefine); setPromptBeforeRefine(null); }}>
                    원래 문장으로
                  </Button>
                )}
              </Flex>
            </Section>

            <Section title="AI 모델">
              <Select.Root value={model} disabled={locked} onValueChange={(v) => setModel(v as ImageModel)}>
                <Select.Trigger aria-label="AI 모델" />
                <Select.Content>
                  {IMAGE_MODELS.map((m) => (
                    <Select.Item key={m.id} value={m.id}>{m.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Section>

            <Section title={`레퍼런스 이미지 (선택, 최대 ${MAX_REFERENCES}장)`}>
              {references.length > 0 && (
                <ul className="references">
                  {references.map((r, i) => (
                    <li key={r.url}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt={`레퍼런스 ${i + 1}`} />
                      <IconButton size="1" radius="full" variant="solid" color="gray" aria-label={`레퍼런스 ${i + 1} 삭제`} disabled={!base || locked} onClick={() => removeReference(i)}>×</IconButton>
                    </li>
                  ))}
                </ul>
              )}
              {references.length < MAX_REFERENCES && (
                <Button asChild variant="outline" disabled={!base || locked}>
                  <label>
                    레퍼런스 추가
                    <input type="file" accept="image/*" multiple hidden disabled={!base || locked} onChange={(e) => { addReferences(e.target.files); e.target.value = ''; }} />
                  </label>
                </Button>
              )}
            </Section>

            <Section title="비율">
              <Select.Root value={String(ratioIdx)} disabled={!base || locked} onValueChange={(v) => { setRatioIdx(Number(v)); setAnchor({ x: 0.5, y: 0.5 }); }}>
                <Select.Trigger aria-label="비율" />
                <Select.Content>
                  {RATIO_PRESETS.map((p, i) => (
                    <Select.Item key={p.label} value={String(i)}>{p.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <SegmentedControl.Root value={mode} disabled={!base || locked} onValueChange={(v) => setMode(v as Mode)}>
                <SegmentedControl.Item value="expand">확장 (AI 채움)</SegmentedControl.Item>
                <SegmentedControl.Item value="crop">크롭</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Section>

            <Section title="도구">
              {/* 항목 단위 비활성화가 없어, AI 전체면 브러시 항목을 숨긴다 */}
              <SegmentedControl.Root value={tool} disabled={!base || locked} onValueChange={(v) => setTool(v as Tool)}>
                <SegmentedControl.Item value="move">위치 이동</SegmentedControl.Item>
                {target !== 'all' && <SegmentedControl.Item value="add">브러시 +</SegmentedControl.Item>}
                {target !== 'all' && <SegmentedControl.Item value="remove">브러시 −</SegmentedControl.Item>}
              </SegmentedControl.Root>
              <Text as="div" size="2" color="gray">브러시 크기 {brushPx}px</Text>
              <Slider aria-label="브러시 크기" min={5} max={150} value={[brushPx]} disabled={!base || locked} onValueChange={([v]) => setBrushPx(v)} />
            </Section>

            {(frameErr || pErr || error) && (
              <Callout.Root role="alert" color="red" size="1">
                <Callout.Text>{frameErr || error || pErr}</Callout.Text>
              </Callout.Root>
            )}
            <Text as="p" aria-live="polite" size="2" color="gray" className="status">{busy}</Text>

            {!result ? (
              <Button size="3" disabled={!base || locked || !!frameErr || !!pErr || nothingToDo} onClick={run}>
                생성
              </Button>
            ) : (
              <Flex direction="column" gap="2">
                {result.raw && (
                  <SegmentedControl.Root value={variant} onValueChange={(v) => setVariant(v as Variant)}>
                    <SegmentedControl.Item value="composite">원본 보존</SegmentedControl.Item>
                    <SegmentedControl.Item value="raw">AI 결과 그대로</SegmentedControl.Item>
                  </SegmentedControl.Root>
                )}
                {/* AI를 썼는데 raw가 없으면 전체 편집이다(보호 영역 없음) */}
                {(variant === 'raw' && result.raw) || (result.usedAI && !result.raw) ? (
                  <Text as="p" size="2" color="gray">인물까지 AI가 다시 그려 자연스럽지만, 얼굴·옷이 미세하게 달라질 수 있어요.</Text>
                ) : (
                  <Text as="p" size="2" color={result.protectedDiff === 0 ? 'green' : 'red'}>
                    보호 영역 변경 {result.protectedDiff.toLocaleString()}px{result.usedAI ? '' : ' (AI 미사용)'}
                  </Text>
                )}
                <Button variant="soft" color="gray" onPointerDown={() => setHoldOriginal(true)} onPointerUp={() => setHoldOriginal(false)} onPointerLeave={() => setHoldOriginal(false)}>
                  누르고 있으면 편집 전
                </Button>
                <Button size="3" disabled={!shown?.ok} onClick={adopt}>채택</Button>
                <Button variant="outline" onClick={discard}>다시</Button>
                {shown?.ok && (
                  <Button asChild variant="soft">
                    <a href={shown.url} download={`snap-up-${versions.length}${variant === 'raw' ? '-ai' : ''}.png`}>PNG 다운로드</a>
                  </Button>
                )}
              </Flex>
            )}
          </Flex>
        </Card>
      </aside>
    </main>
  );
}
