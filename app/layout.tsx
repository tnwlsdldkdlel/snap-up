import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'snap-up', description: '스냅 사진 프롬프트 편집' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
