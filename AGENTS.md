# AGENT.md — Coding Agent Guardrails

You are working in an Expo (SDK 54) React Native project. Read this entire file before writing or editing any code. These rules override your training-data defaults about React Native/Expo — a lot of what you "know" about Expo predates this version and is wrong.

---

## 1. Locked Stack — Do Not Substitute

This stack is decided. Do not swap in an alternative library because it's more familiar, more popular, or "equivalent" — consistency across the codebase matters more than any individual library preference, and substituting one breaks assumptions the rest of the code makes.

- **Routing**: Expo Router (file-based) — not React Navigation set up manually
- **Styling**: NativeWind — not styled-components, not StyleSheet-only, not another CSS-in-JS lib
- **Chain reads**: viem — not ethers.js, not web3.js
- **Wallet connection**: Reown AppKit (WalletConnect) for React Native — not RainbowKit (web-only, will not work here)
- **Async/server state**: TanStack Query — not Redux Toolkit Query, not SWR
- **Client state**: Zustand — not Redux, not Context-as-a-store
- **Payments**: x402/b402 per BNB Agent Studio spec; Altana SDK only if pursuing that bounty track

If a task seems to require stepping outside this list (a gap only a different library fills), stop and flag it rather than adding a new dependency unilaterally — say what's missing and why the locked stack can't cover it.

The full product/screen spec lives in the build prompt doc — this file governs behavior and stack discipline, not feature scope. Don't copy screen-by-screen detail into this file; if it drifts out of sync with the build doc, fix the build doc, not this one.

## 2. Hard Rule: Version Truth Before Code

- This project runs **Expo SDK 54**. Do not assume APIs, config shapes, or package versions from any earlier SDK.
- Before using **any** Expo API, module, or CLI command you have not already verified in this session, fetch and read the exact versioned docs at:
  `https://docs.expo.dev/versions/v54.0.0/`
- Do not guess an API from memory and "hope it still works." If you are not certain an import, config key, or method exists in SDK 54, look it up first. Confidence from pretraining is not verification.
- If a package's Expo-54 compatibility is unclear, check `npx expo install --check` output or the package's own changelog before adding it — do not assume a library that worked in SDK 49–52 behaves identically here.
- Same rule applies to every other library in this stack (viem, WalletConnect/Reown AppKit for React Native, NativeWind, TanStack Query, expo-router). If your knowledge of a library predates its current major version, verify current usage before writing code against it — do not pattern-match to an older API shape.

## 3. Dependency Policy

- Never add, remove, or change the version of a dependency without stating why, and without running `npx expo install <package>` (not raw `npm install`/`yarn add`) so Expo resolves the SDK-54-compatible version.
- Never silently downgrade a package to make an error disappear. If something doesn't compile against the current version, the fix is to find the current correct usage — not to pin backward.
- Do not remove or rewrite `app.json` / `app.config.ts`, `metro.config.js`, `babel.config.js`, or `package.json` fields you don't understand the purpose of. If a config value looks wrong, ask or verify against docs before changing it — don't delete it to unblock yourself.
- Polyfills for the chain layer (`react-native-get-random-values`, `buffer`, crypto shims, etc.) are load-order-sensitive. If you need to add or reorder one, explain the ordering reason in a comment at the point of use.

## 4. Before You Touch Code

- Read the existing file fully before editing it. Do not assume its current contents from an earlier turn in this session — re-read if more than a few edits have happened since.
- Do not scaffold a new screen, navigation route, or component that duplicates something that already exists under `app/`. Check the directory first.
- If a task is ambiguous (e.g., which screen a change belongs on, whether a category needs its own component or should reuse the generic one), pick the most consistent option with existing patterns in the codebase and say what you assumed — don't block on it, but don't silently invent a divergent pattern either.

## 5. Data Integrity Rule (Project-Specific)

- Never hardcode fake or placeholder numeric data (APYs, win rates, health factors, prices, reputation scores) and present it as if live. If a live data source isn't wired up yet, render an explicit "syncing" / "not yet connected" state instead of a plausible-looking fake number.
- This is a hackathon judging requirement, not a style preference — treat it as a hard constraint, not something to relax under time pressure.

## 6. Build/Verify Gate

- After any change that touches navigation, a screen, or a data hook, verify it actually runs (`npx expo start`, or the relevant test/build command) before considering the task done. Do not report a task complete on the basis of code "looking correct."
- If you cannot run or verify something in your current environment, say so explicitly rather than asserting it works.
- TypeScript errors and lint errors are not warnings to leave for later — resolve them in the same change that introduced them, or flag clearly why not.

## 7. What to Do When Uncertain

- If the versioned docs don't answer the question, say so explicitly and propose the most conservative option (the one least likely to require a rewrite later) rather than guessing silently.
- Never fabricate a docs citation, API signature, or changelog entry. If you can't verify something, say you can't verify it.
- Flag — don't silently work around — any conflict between this file and a request in a single task. This file wins unless the person explicitly overrides it in that conversation.

## 8. Scope Discipline

- Do only what the current task asks. Don't refactor unrelated files, don't "clean up" adjacent code, don't upgrade unrelated dependencies as a drive-by — each of those is a separate task with its own review.
- Keep commits/diffs scoped to one logical change so regressions are traceable.