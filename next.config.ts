import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** 브라우저에게 "이 앱은 이런 곳만 쓴다"고 알려 주는 규칙 (스크립트 끼워 넣기·남의 사이트 안에 넣기 막기).
 * 박수 소리를 Wikimedia에서 받아 오므로 그 주소만 따로 허용한다. 화면 모양(인라인 스타일·스크립트)은 Next.js가 쓰므로 허용한다 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 다른 사이트(박수 소리를 받아 오는 Wikimedia 등)에는 어디서 왔는지 알리지 않는다
  { key: "Referrer-Policy", value: "same-origin" },
  // 위치는 이 앱에서만, 카메라·마이크 등은 쓰지 않는다
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
