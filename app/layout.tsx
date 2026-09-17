import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Nanum_Gothic_Coding } from "next/font/google";
import "./globals.css";

// 영문/숫자는 JetBrains Mono, 한글은 나눔고딕코딩으로 폴백
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const nanumGothicCoding = Nanum_Gothic_Coding({
  weight: ["400", "700"],
  variable: "--font-nanum-coding",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "ESCAPE_",
  description: "Text-based escape room TRPG",
};

export const viewport: Viewport = {
  themeColor: "#050505",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${jetbrainsMono.variable} ${nanumGothicCoding.variable}`}>
      <body className="bg-void font-mono text-bone antialiased">{children}</body>
    </html>
  );
}
