import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo holds two independent projects: the Expo mobile app at the root
  // and this Next.js site under web/. Both have their own package-lock.json,
  // and Turbopack infers the workspace root by walking up to the first lockfile
  // it finds - which picked the repo root and warned about "multiple lockfiles"
  // (verified against node_modules/next/dist/docs, "Root directory": it looks
  // for pnpm-lock.yaml / package-lock.json / yarn.lock / bun.lock).
  //
  // Pinning the root to this folder keeps module resolution, cache validation
  // and file watching inside web/, so the mobile app's dependency tree can
  // never be pulled into the website's build.
  turbopack: {
    root: path.join(__dirname),
  },
  /*
   * The Set and Earn tracking API lives on Convex's HTTP host
   * (convex/http.ts). Proxied here so the URL handed to BNB Chain is on our own
   * domain and survives a backend move. The .site host is the .cloud URL with
   * one word changed - that is Convex's own convention for a deployment.
   */
  /*
   * SECURITY HEADERS (pre-launch review, 2026-09-29). The site sent none.
   * For a wallet app the one that matters most is framing: without it any
   * page could load Dolphin invisibly and trick a click on Hire or Grant.
   * `frame-ancestors 'none'` is the whole CSP on purpose - a full policy has
   * to list every wallet, RPC, data and media origin, and one miss would
   * break the live site; that is a follow-up with its own test pass.
   * Shape verified against node_modules/next/dist/docs (content-security-policy.md).
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  async rewrites() {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim().replace(/\/+$/, "");
    if (!convexUrl) return [];
    const siteUrl = convexUrl.replace(/\.convex\.cloud$/, ".convex.site");
    return [{ source: "/api/v1/:path*", destination: `${siteUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
