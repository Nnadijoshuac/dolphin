// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Agent/ is git-ignored agent working context (handovers, session logs,
    // browser and Convex diagnostic scratch) — not source, not linted.
    ignores: ["dist/*", "Agent/*"],
  }
]);
