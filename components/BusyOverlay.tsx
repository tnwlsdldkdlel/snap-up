'use client';
import { Flex, Progress, Spinner, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import { expectText, formatElapsed, percentOf, stepIndex } from '../lib/progress';

type Props = {
  text: string;
  startedAt: number;
  /** 단계가 있는 작업(생성)이면 단계 표시줄을 그린다 */
  steps?: readonly string[];
  /** 단계 표시줄에 쓰는 짧은 이름(steps와 같은 순서) */
  labels?: readonly string[];
  expectSec?: number;
};

/** 사진 위 진행 표시. 같은 문구를 패널의 aria-live가 읽으므로 여기서는 화면 표시만 한다 */
export default function BusyOverlay({ text, startedAt, steps, labels, expectSec }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - startedAt;
  const current = steps ? stepIndex(steps, text) : -1;
  const pct = percentOf(text);

  return (
    <div className="busy-overlay" aria-hidden="true">
      <Flex direction="column" align="center" gap="3" className="busy-card">
        <Spinner size="3" />
        <Text size="3" weight="medium" align="center">{text}</Text>
        {pct !== null && <Progress value={pct} size="2" style={{ width: 220 }} />}
        <Text size="2" color="gray" align="center">
          {formatElapsed(elapsed)} 경과{expectSec ? ` · ${expectText(elapsed, expectSec)}` : ''}
        </Text>
        {steps && current >= 0 && (
          <ol className="busy-steps">
            {steps.map((s, i) => (
              <li key={s} data-state={i < current ? 'done' : i === current ? 'active' : 'todo'}>
                <span className="dot" />
                {labels?.[i] ?? s}
              </li>
            ))}
          </ol>
        )}
      </Flex>
    </div>
  );
}
