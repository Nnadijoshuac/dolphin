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

The full product/screen spec, tech stack decisions, and build strategy live in **project-scope.md** — read it before starting any task, and re-read it if scope or architecture questions come up mid-task. This file governs behavior and stack discipline, not feature scope. Don't copy screen-by-screen detail into this file; if it drifts out of sync with project-scope.md, fix project-scope.md, not this one.

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

## 9. Convex Backend Conventions

The backend (`convex/`) follows patterns already established in the codebase — match them, don't invent parallel ones:

- **Live-data metrics use the `LiveMetric<T>` shape everywhere**, mirrored between `src/types/agent.ts` (client) and `convex/lib/liveMetric.ts` (server validator) by hand — Convex validators aren't generated from TypeScript types, so when one changes, update the other in the same change and say so in the commit.
- **Category stat shapes live in `convex/categoryStatsValidators.ts`**, one validator per `AgentCategory`, field-for-field matching the corresponding type in `src/types/agent.ts`. Same manual-sync rule as above.
- **Protocol reads live one file per protocol under `convex/protocols/`** (`venus.ts`, `pancakeswap.ts`, `aave.ts`, etc.), each exporting a single `readXStats(agentWallet, checkedAt)` function that returns the category's live-stats shape. A protocol with no wired read yet gets an explicit function in `unavailable.ts`, not a TODO left in the real module.
- **Never hardcode a contract address without independent verification.** Before writing an address into a protocols module: check it against the protocol's own official GitHub deployments file or docs (not just a search snippet), cross-reference a second source where possible, and say in a code comment where it came from and what confidence level it has. This project has already been burned by how costly a wrong address would be if presented as "real, live, on-chain" — treat every new address with the same suspicion as the ones already verified in the codebase.
- **A metric with no live source yet is `unavailableMetricValue(reason, source, checkedAt)`, never a fabricated number.** This is the Convex-side enforcement of Rule 5 (Data Integrity) — it applies exactly the same to backend aggregation code as to the client.
- **`_generated/` is real Convex codegen output once `npx convex dev` has run** — do not hand-write stand-ins for it going forward. If you find code still referencing `anyApi` or a hand-rolled `makeFunctionReference` call, that's a leftover from before codegen existed and should be swapped to the generated `api`/`internal` imports as a matter of course, not treated as a design choice to preserve.

## 10. Commit Discipline

- Commit after every file you create, edit, or delete — not batched at the end of a session.
- One logical change per commit. A new endpoint plus its types plus its hook can be one commit; unrelated changes never share one.
- Write a clear, conventional commit message: short imperative summary (`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`), with a body when the change needs context a diff alone won't give a future reader.
- Never leave uncommitted changes at the end of a task or session.
- Before committing anything that touches config, env files, or permission/settings files, check it doesn't contain a secret (private key, API token) — these have leaked into `.claude/settings.json` before via approved command strings. If you spot one, flag it and remove it in its own commit rather than letting it ride along with unrelated work.

## 11. UI/Frontend Boundary

Unless a specific task explicitly says otherwise, treat the UI/frontend layer as off-limits — the person builds it directly and in parallel. This means, by default:

- No screen/route files under `app/(tabs)/`, `app/agent/`, `app/category/`, `app/hire/`, `app/manage/`, `app/onboarding/`
- No component whose primary purpose is rendering UI (layout, styling, NativeWind classes, navigation structure, animations, icons), and no design-system primitives
- If a task seems to need a UI change, build the underlying logic/data/hook so it's ready to consume, note what UI-side integration will eventually be needed, and stop there — do not make the UI change yourself
- If unsure whether a file is "logic" or "UI," default to not touching it and flag it

This boundary lifts only when a task explicitly says so for that task. It is not a one-time instruction from a single prompt — treat it as standing unless told otherwise.