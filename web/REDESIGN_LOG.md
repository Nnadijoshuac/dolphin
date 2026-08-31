# Dolphin Web Redesign Log

Last updated: 2026-08-31

## Recovery checkpoint

- Working branch: `codex/web-ui-redesign`
- Remote branch: `origin/codex/web-ui-redesign`
- Baseline `npm run typecheck`: passing before redesign work
- Product source of truth: `../project-scope.md`
- Data source of truth: existing Convex queries, hooks, wallet provider, and session-grant logic
- Resume from: shared design foundation and application shell

## Visual direction

Dolphin's web experience is a calm, light-first marketplace for discovering and safely authorizing on-chain AI agents. It must feel trustworthy before it feels technical.

Reference blend:

- [Rogo](https://rogo.com/) — confident editorial hierarchy for AI and finance
- [Vercel Marketplace](https://vercel.com/marketplace) — search, categories, and compact marketplace listings
- [Claude Connectors](https://claude.com/connectors) — warm canvas and readable filter/list structure
- [Onramper](https://onramper.com/) — restrained crypto cues without dashboard spectacle
- [Zerion Portfolio](https://app.zerion.io/portfolio/overview) — wallet balance and activity hierarchy
- [Safe Wallet](https://app.safe.global/) — explicit account control, permissions, and transaction language
- [Base account permissions](https://help.coinbase.com/en/wallet/getting-started/smart-wallet-permissions) — plain-language session limits and revocation

Non-negotiable guardrails:

- Warm off-white canvas; no black-led shell or dark hero
- Flat, editorial structure; no card-inside-card layouts
- One gold action color, used sparingly
- Real data states only: live, syncing, stale, unavailable, or empty
- No fabricated scores, balances, activity, testimonials, or protocol claims
- Search and four graded categories remain immediately visible
- Wallet explains ownership, permissions, expiry, and revocation in plain language
- Responsive and keyboard-accessible at every milestone

## Milestones

| Milestone | Status | Last commit | Verification |
| --- | --- | --- | --- |
| Research and route audit | In progress | — | Reference set recorded |
| Shared design foundation | Not started | — | — |
| Navigation and application shell | Not started | — | — |
| Discover and Search | Not started | — | — |
| Agent detail and Hire | Not started | — | — |
| My Agents | Not started | — | — |
| Wallet | Not started | — | — |
| Responsive, accessibility, and final audit | Not started | — | — |

## Resume commands

```powershell
git switch codex/web-ui-redesign
git status --short --branch
cd web
npm run typecheck
npm run dev
```

After every meaningful milestone:

```powershell
npm run typecheck
npm run lint
git push origin codex/web-ui-redesign
```

Update this file with the last completed commit, verification result, and exact next task before stopping.
