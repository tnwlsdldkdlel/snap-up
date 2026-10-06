'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Stage, { type Tool } from '../components/Stage';
import { RATIO_PRESETS, anchorFromOffset, checkFrame, planFrame, type Mode, type Size, type Target } from '../lib/canvas';
import type { RGBA } from '../lib/composite';
import { MAX_INPUT_PX, MAX_VERSIONS } from '../lib/limits';
import { BRUSH_NONE, buildEditMask, paintBrush, resizeBilinear, type Mask } from '../lib/mask';
import { promptError } from '../lib/prompt';
import { decodeFile, rgbaToCanvas } from '../lib/browser';
import { generate, segment, type GenerateResult } from '../lib/pipeline';

type Version = { blob: Blob; url: string };
type Result = GenerateResult & { url: string };
const PREVIEW_SIDE = 1600;
const BRUSH_SIDE = 1024;

const scaled = (s: Size, side: number): Size => {
  const k = Math.min(1, side / Math.max(s.w, s.h));
  return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
};

export default function Page() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [current, setCurrent] = useState(0);
  const [base, setBase] = useState<RGBA | null>(null);
  const [preview, setPreview] = useState<ImageBitmap | null>(null);
  const [target, setTarget] = useState<Target>('none');
  const [prompt, setPrompt] = useState('');
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

  const bs = base ? scaled(base, BRUSH_SIDE) : null;
  const ratio = RATIO_PRESETS[ratioIdx].ratio;
  const frame = base ? planFrame(base, ratio, mode, anchor) : null;
  const frameErr = base && frame ? checkFrame(base, frame) : null;
  const expanded = !!(base && frame && (frame.cw > base.w || frame.ch > base.h));
  const nothingToDo = target === 'none' && ratio === null;
  const pErr = target === 'none' && !expanded ? null : promptError(target, prompt, expanded);

  useEffect(() => {
    if (versions.length < 2 && !result) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [versions.length, result]);

  const overlay = useMemo(() => {
    if (!bs || target === 'none') return null;
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
    if (img.w * img.h > MAX_INPUT_PX) throw new Error('40MP 이하 사진만 지원해요.');
    const p = scaled(img, PREVIEW_SIDE);
    setPreview(await createImageBitmap(rgbaToCanvas(img), { resizeWidth: p.w, resizeHeight: p.h, resizeQuality: 'high' }));
    setBase(img);
    setSeg(null);
    setSegSmall(null);
    setTarget('none');
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
      await applyBase(await decodeFile(file));
      versions.forEach((v) => URL.revokeObjectURL(v.url));
      if (result) URL.revokeObjectURL(result.url);
      setResult(null);
      setVersions([{ blob: file, url: URL.createObjectURL(file) }]);
      setCurrent(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 열 수 없어요.');
    } finally {
      setBusy('');
    }
  }

  async function chooseTarget(t: Target) {
    setTarget(t);
    setTool(t === 'none' ? 'move' : tool);
    if (t === 'none' || seg || !base || !bs) return;
    setError('');
    setBusy('인물 인식 중');
    try {
      const m = await segment(base);
      setSeg(m);
      setSegSmall(resizeBilinear(m, base.w, base.h, bs.w, bs.h));
    } catch {
      setError('자동 인식에 실패했어요. 브러시로 칠해서 진행하세요.');
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
        { base, frame, target, prompt, seg, brush: target === 'none' ? null : { mask: brush.current, w: bs.w, h: bs.h } },
        setBusy,
      );
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : '생성에 실패했어요.');
    } finally {
      setBusy('');
    }
  }

  async function adopt() {
    if (!result || result.protectedDiff > 0) return;
    const next = [...versions, { blob: result.blob, url: result.url }];
    if (next.length > MAX_VERSIONS) URL.revokeObjectURL(next.splice(1, 1)[0].url);
    setVersions(next);
    setCurrent(next.length - 1);
    setResult(null);
    await applyBase(result.out);
  }

  function discard() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  }

  async function selectVersion(i: number) {
    setError('');
    setBusy('불러오는 중');
    try {
      await applyBase(await decodeFile(versions[i].blob));
      setCurrent(i);
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
          <img className="result" src={holdOriginal ? versions[current].url : result.url} alt={holdOriginal ? '편집 전' : '편집 결과'} />
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
        <label className="file">
          새 사진
          <input type="file" accept="image/*" disabled={!!busy} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        <fieldset disabled={!base || locked}>
          <legend>수정 대상</legend>
          {(['none', 'background', 'person'] as Target[]).map((t) => (
            <label key={t}>
              <input type="radio" name="target" checked={target === t} onChange={() => chooseTarget(t)} />
              {{ none: '없음 (비율만)', background: '배경', person: '인물' }[t]}
            </label>
          ))}
        </fieldset>

        <label className="field">
          프롬프트
          <textarea
            value={prompt}
            maxLength={2000}
            rows={4}
            disabled={!base || locked}
            placeholder={target === 'none' ? '확장 영역에 바라는 점 (선택)' : '예: 배경을 해 질 녘 바닷가로'}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>

        <fieldset disabled={!base || locked}>
          <legend>비율</legend>
          <select value={ratioIdx} onChange={(e) => { setRatioIdx(Number(e.target.value)); setAnchor({ x: 0.5, y: 0.5 }); }}>
            {RATIO_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
          {(['expand', 'crop'] as Mode[]).map((m) => (
            <label key={m}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'expand' ? '확장 (AI 채움)' : '크롭'}
            </label>
          ))}
        </fieldset>

        <fieldset disabled={!base || locked}>
          <legend>도구</legend>
          {(['move', 'add', 'remove'] as Tool[]).map((t) => (
            <label key={t}>
              <input type="radio" name="tool" checked={tool === t} disabled={t !== 'move' && target === 'none'} onChange={() => setTool(t)} />
              {{ move: '위치 이동', add: '브러시 +', remove: '브러시 −' }[t]}
            </label>
          ))}
          <label className="field">
            브러시 크기 {brushPx}px
            <input type="range" min={5} max={150} value={brushPx} onChange={(e) => setBrushPx(Number(e.target.value))} />
          </label>
        </fieldset>

        {(frameErr || pErr || error) && <p role="alert" className="error">{frameErr || error || pErr}</p>}
        <p aria-live="polite" className="status">{busy}</p>

        {!result ? (
          <button type="button" className="primary" disabled={!base || locked || !!frameErr || !!pErr || nothingToDo} onClick={run}>
            생성
          </button>
        ) : (
          <div className="result-actions">
            <p className={result.protectedDiff === 0 ? 'ok' : 'error'}>
              보호 영역 변경 {result.protectedDiff.toLocaleString()}px{result.usedAI ? '' : ' (AI 미사용)'}
            </p>
            <button type="button" onPointerDown={() => setHoldOriginal(true)} onPointerUp={() => setHoldOriginal(false)} onPointerLeave={() => setHoldOriginal(false)}>
              누르고 있으면 편집 전
            </button>
            <button type="button" className="primary" disabled={result.protectedDiff > 0} onClick={adopt}>채택</button>
            <button type="button" onClick={discard}>다시</button>
            {result.protectedDiff === 0 && (
              <a className="download" href={result.url} download={`snap-up-${versions.length}.png`}>PNG 다운로드</a>
            )}
          </div>
        )}
      </aside>
    </main>
  );
}
