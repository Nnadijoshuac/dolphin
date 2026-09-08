import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * There was no test runner, no test script and no test file in this project.
 *
 * The tests added alongside this config are deliberately NOT component-render
 * tests. What broke on this site historically was never JSX: it was the pure
 * logic between the backend and the screen - a category guard that rejected
 * eight of thirteen valid slugs, a label lookup that returned the literal
 * string "Monitoring" for anything it did not recognise, a hand-written API
 * annotation that drifted from the backend, an agentKey passed to BigInt().
 * Every one of those is a function with an input and an output, and every one
 * of them is what these tests cover.
 *
 * jsdom rather than node because two of the units under test are hooks that
 * touch timers and `window`.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
