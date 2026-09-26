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
  async rewrites() {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim().replace(/\/+$/, "");
    if (!convexUrl) return [];
    const siteUrl = convexUrl.replace(/\.convex\.cloud$/, ".convex.site");
    return [{ source: "/api/v1/:path*", destination: `${siteUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
