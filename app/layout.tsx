import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "기술 추적",
  description: "공식·1차 출처를 기반으로 기술의 검증, 규제, 생산, 운영, 접근 상태를 추적하는 데이터 인덱스",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <meta name="theme-color" content="#ffffff" />
        <meta name="codex-preview" content="development" />
      </head>
      <body>{children}</body>
    </html>
  );
}
