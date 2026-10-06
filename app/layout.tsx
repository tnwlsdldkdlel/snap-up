import '@radix-ui/themes/styles.css';
import './globals.css';
import { Theme } from '@radix-ui/themes';
import type { ReactNode } from 'react';

export const metadata = { title: 'snap-up', description: '스냅 사진 프롬프트 편집' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 동적 서브셋: 페이지에 쓰인 글자만 내려받는다 */}
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <Theme accentColor="indigo" grayColor="slate" radius="medium">
          {children}
        </Theme>
      </body>
    </html>
  );
}
