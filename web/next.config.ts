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
};

export default nextConfig;
