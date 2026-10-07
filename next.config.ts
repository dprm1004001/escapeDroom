import type { NextConfig } from "next";

// GitHub Pages 빌드(GitHub Actions)에서만 켜짐:
// 정적 파일로 내보내고, https://dprm1004001.github.io/escapeDroom/ 경로에 맞춘다.
const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = isGithubPages
  ? {
      output: "export",
      basePath: "/escapeDroom",
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
