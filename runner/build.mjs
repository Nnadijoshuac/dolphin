// Builds the Dolphin runner into ONE file the website serves: web/public/runner/dolphin-runner.mjs.
// It bundles convex/lib/strategy.ts, so the runner and Dolphin decide with the very same engine.
// Run after changing runner/main.ts or convex/lib/strategy.ts:  node runner/build.mjs
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "web/public/runner/dolphin-runner.mjs");
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "runner/main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  banner: { js: "// Dolphin runner - built from github.com/Nnadijoshuac/dolphin runner/main.ts. Your keys never leave this machine." },
});
console.log(`built ${outfile}`);
