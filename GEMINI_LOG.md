# GEMINI_LOG — Session 2026-08-29T18:52 UTC+1

## Context

Picking up Dolphin project. Read HANDOVER.md (all addenda, newest first),
AGENTS.md, `.github/workflows/deploy-web.yml`, `.github/workflows/build-web-site.yml`
in full before starting.

**Primary task:** Regenerate `package-lock.json` for both root and `web/` on a
genuine Linux environment so CI can switch from `npm install` back to `npm ci`.

**Off-limits files** (another agent working in parallel):
- `convex/lib/agentCatalog.ts`
- `convex/agents.ts`
- `convex/lib/classification.ts`
- `convex/discoveredAgents.ts`
- Anything about agent icons/classification
- UI files

**Environment:** Node 24.13.0, npm 11.6.2, Windows. No WSL distro installed,
no Docker. Matches what HANDOVER.md already documented.

---

## Investigation

### Current dependency snapshots (for later verification that nothing changed)

**Root `package.json` top-level deps** (45 deps + 5 devDeps):
Key versions: expo ^54.0.0, react 19.1.0, react-native 0.81.5, convex ^1.45.0,
viem 2.55.19, wagmi 2.19.5, nativewind 4.2.6, typescript ~5.9.2

**`web/package.json` top-level deps** (8 deps + 8 devDeps):
Key versions: next 16.3.3, react 19.2.8, convex ^1.45.0, viem ^2.56.0,
wagmi ^2.19.5, tailwindcss ^4, typescript ^5

### Root cause (from workflow comments, verified)

npm records optional platform-specific packages' own dependencies only for the
platform the lockfile was resolved on. Both lockfiles were authored on Windows.
`@napi-rs/wasm-runtime` (optional) is committed with only `@tybys/wasm-util` in
its dependencies, missing `@emnapi/core` and `@emnapi/runtime` which Linux needs.
`npm ci` on Linux therefore fails:

```
npm error code EUSAGE
npm error Missing: @emnapi/core@1.11.3 from lock file
npm error Missing: @emnapi/runtime@1.11.3 from lock file
```

This cannot be fixed on Windows — regenerating the lockfile on Windows *removes*
those entries instead of adding them.

### Approach

1. Install WSL Ubuntu to get a genuine Linux environment on this machine
2. Run `npm install` in both projects on Linux to regenerate lockfiles with
   cross-platform optional deps resolved
3. Verify `npm ci` succeeds on the same Linux environment
4. Confirm no top-level dependency versions changed
5. Update both CI workflows to use `npm ci`
6. Commit incrementally

WSL install started at 18:53. Waiting for it to complete...

---

## Execution
