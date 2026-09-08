# Dolphin — website

The public web surface of Dolphin: discovery, agent records, hiring and reviews
for ERC-8004 agents on BNB Smart Chain.

**Live: https://dolphinamp.vercel.app**

This is one of two frontends in this repository. See
[Two frontends](#two-frontends-and-why) below before adding a feature, because
almost every feature has to be considered for both.

---

## Deployment

**Host: Vercel. Deployed by Vercel's own Git integration, not by a workflow in
this repository.**

Vercel watches this repository directly and builds `web/` on every push. There
is no `vercel deploy` step, no `VERCEL_TOKEN`, and nothing in `.github/workflows`
that publishes this site.

| Branch | Result |
| --- | --- |
| `main` | Production — https://dolphinamp.vercel.app |
| any other branch | A Vercel preview URL, posted on the pull request |

**Root directory is `web/`.** The repository root is an Expo app with its own
`package.json`; the Vercel project must be configured with `web` as its root
directory or it will build the wrong project.

### Environment variables

Set these in the Vercel project settings, for Production *and* Preview:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | yes | Must point at the **same** Convex deployment as the mobile app's `EXPO_PUBLIC_CONVEX_URL`. This is what makes both surfaces show identical data. |
| `NEXT_PUBLIC_BSC_RPC_URL` | no | Falls back to `https://bsc-dataseed.bnbchain.org`. A dedicated endpoint is strongly preferred in production. |
| `NEXT_PUBLIC_SITE_URL` | no | Absolute origin, used for canonical URLs, `sitemap.xml` and OpenGraph images. Defaults to `https://dolphinamp.vercel.app`. Set it on preview deployments only if you want previews to advertise themselves as canonical — normally you do not. |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | no | Reown/WalletConnect QR pairing. Without it only injected (extension) wallets can connect. |

`NEXT_PUBLIC_*` values are inlined into the browser bundle by design. None of
them is a secret. The one real secret in this project (`SCAN8004_API_KEY`) is
Convex-side only and is never referenced here.

**These are a second copy of the same configuration CI holds** in
`.github/workflows/build-web-site.yml`. When one changes, change both. The
failure mode when they drift is that CI passes against one Convex deployment
while production serves another — which has already happened once, on
2026-09-07, when the backend moved deployments and this site was left pointing
at the old one.

### What CI does and does not do

`.github/workflows/build-web-site.yml` runs typecheck, lint and a clean-install
Linux build. It does **not** deploy. It exists because Vercel runs `next build`
and nothing else: a type error or a lint failure will deploy happily, and a
failed Vercel build silently keeps serving the previous version. CI is the gate
that reports on the pull request, before the merge that would promote it.

---

## Local development

```bash
cd web
npm install
cp .env.example .env.local   # then fill in NEXT_PUBLIC_CONVEX_URL
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run check:convex-api` | Verifies `src/convex/api.ts` still matches the real backend (see below) |
| `npm run verify` | All four of the above, in the order CI runs them |

`npm run typecheck` runs `next typegen` first on purpose: Next 16 generates the
global route types (`PageProps`, `LayoutProps`) into `.next/types`, which is not
committed, so a clean clone fails typecheck before anything has built.

---

## Architecture notes

### The backend is Convex, and this project does not import its codegen

`src/convex/api.ts` declares the Convex functions this site calls, as
hand-written type annotations over `anyApi`. It does **not** import
`convex/_generated/api` from the repository root, because that would make this
project's build reach outside `web/` and resolve `convex` from the root
`node_modules` — so the site could not install or build from a clean clone
without the mobile app also being installed.

The cost of that decision is real and has already been paid once: on 2026-09-06
the backend swapped `walletAddress` for `sessionToken` on every authenticated
write, the hand-written annotation did not fail to compile, and every hire on
the site failed at runtime with `ArgumentValidationError`.

**`npm run check:convex-api` exists because of that outage.** It parses the real
`convex/*.ts` modules and asserts that every function this site declares still
exists, is public rather than internal, and still takes the arguments declared
here. It runs first in CI. A clean `tsc --noEmit` proves nothing about whether
this site can talk to its backend; that script is what does.

It is a name-level check by design — it cannot see a `v.string()` that became a
`v.number()`. It does catch every failure this project has actually had, and it
found a real one on its first run: `agents.list` and `agents.search` have taken
an `a2a`/`mcp` `protocol` filter since the backend rebuild, and the website had
never declared it, so the filter could not be offered at all.

### Data honesty

Every metric rendered here is a `LiveMetric<T>` carrying `status`, `source`,
`asOf` and optionally `methodology`, and `MetricCell` renders all four. A value
with no live source is `unavailable` with a stated reason — never a plausible
number. This is a hard project constraint, not a style preference; see
`AGENTS.md` §5.

The same rule applies to *absences*. When the backend cannot be reached, the
site says the catalog is unreachable — it does not say the catalog is empty.
See `src/components/backend-status.tsx`.

### Categories are open strings

`agents.categorySlug` is a free string on the backend, and the browse chips are
read from the data via `useCategoryFacets()`. Never hardcode the category list
and never index a `Record<AgentCategory, T>` directly — use `categoryLabel()`
from `src/constants/agents.ts`, which is total by construction.

---

## Two frontends, and why

This repository ships two independent frontends against one Convex backend:

- **`/` (repository root)** — the Expo / React Native app. Deploys its web
  export to GitHub Pages via `deploy-web.yml`, and to devices via EAS.
- **`web/`** — this Next.js site. Deploys to Vercel.

They are not the same product and should not be merged, but every feature costs
twice, and the drift is one-directional and measurable: reviews, retention,
onboarding and the manage path each existed on mobile for some time before
reaching here.

**If you add a user-facing feature to one, open an issue for the other in the
same change.** See `Agent/DECISION-2026-09-08-two-frontends.md` for the full
argument and the conditions under which this should be revisited.
