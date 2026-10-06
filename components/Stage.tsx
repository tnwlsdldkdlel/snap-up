'use client';
import { useEffect, useRef } from 'react';
import type { Frame, Size } from '../lib/canvas';

export type Tool = 'move' | 'add' | 'remove';

type Props = {
  preview: ImageBitmap;
  base: Size;
  frame: Frame;
  overlay: ImageData | null;
  tool: Tool;
  brushPx: number;
  onMove(ox: number, oy: number): void;
  /** 기준 이미지 대비 정규화 좌표(0..1)와 반지름(기준 너비 비율) */
  onPaint(nx: number, ny: number, nr: number, add: boolean): void;
};

const MAX_W = 900;
const MAX_H = 680;

export default function Stage({ preview, base, frame, overlay, tool, brushPx, onMove, onPaint }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const k = Math.min(MAX_W / frame.cw, MAX_H / frame.ch);
  const dw = Math.round(frame.cw * k);
  const dh = Math.round(frame.ch * k);

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.clearRect(0, 0, dw, dh);
    ctx.fillStyle = '#c9d3e0'; // 확장(AI 채움) 영역
    ctx.fillRect(0, 0, dw, dh);
    const [x, y, w, h] = [frame.ox * k, frame.oy * k, base.w * k, base.h * k];
    ctx.drawImage(preview, x, y, w, h);
    if (overlay) {
      const oc = new OffscreenCanvas(overlay.width, overlay.height);
      oc.getContext('2d')!.putImageData(overlay, 0, 0);
      ctx.drawImage(oc, x, y, w, h);
    }
  }, [preview, base, frame, overlay, k, dw, dh]);

  function paint(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const s = dw / r.width; // CSS 축소 보정(캔버스 내부 폭 / 표시 폭)
    const nx = (((e.clientX - r.left) * s) / k - frame.ox) / base.w;
    const ny = (((e.clientY - r.top) * s) / k - frame.oy) / base.h;
    onPaint(nx, ny, (brushPx * s) / k / base.w, tool === 'add');
  }

  return (
    <canvas
      ref={ref}
      width={dw}
      height={dh}
      className={`stage-canvas tool-${tool}`}
      aria-label="편집 미리보기"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (tool === 'move') drag.current = { x: e.clientX, y: e.clientY, ox: frame.ox, oy: frame.oy };
        else paint(e);
      }}
      onPointerMove={(e) => {
        if (!e.buttons) return;
        if (tool !== 'move') return paint(e);
        const d = drag.current;
        if (!d) return;
        const s = dw / e.currentTarget.getBoundingClientRect().width;
        onMove(d.ox + ((e.clientX - d.x) * s) / k, d.oy + ((e.clientY - d.y) * s) / k);
      }}
      onPointerUp={() => (drag.current = null)}
    />
  );
}
