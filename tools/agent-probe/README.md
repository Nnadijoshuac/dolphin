# agent-probe

**Is this on-chain agent actually alive?**

Hundreds of thousands of AI agents are registered on-chain (ERC-8004). Far fewer answer when called: on BNB Chain on 29 September 2026, 73 did. `agent-probe` is the checker Dolphin uses to tell them apart, released so that anyone can check any agent themselves and reproduce Dolphin's numbers.

It sends exactly what a buyer's first request would send, and reports what came back:

- **A2A agents:** it reads the agent card, finds the real endpoint the card names, and makes the `negotiate` call that an ERC-8183 hire begins with. It checks that any quote names the agent's own registered wallet as the payee.
- **MCP agents:** it runs the `initialize` handshake and `tools/list`, and counts the tools.

It needs no key and no account, and writes nothing anywhere. Every request goes through a guarded fetch that refuses private and cloud-metadata addresses, re-checks each redirect, and caps size and time.

## Usage

```
npx tsx tools/agent-probe/cli.mts 49467                          # an ERC-8004 agent on BNB Chain, by token id
npx tsx tools/agent-probe/cli.mts 56:0x8004a169...:49467          # by full agent key (chain:registry:tokenId)
npx tsx tools/agent-probe/cli.mts --a2a https://host/.well-known/agent-card.json [--wallet 0x...]
npx tsx tools/agent-probe/cli.mts --mcp https://host/mcp
```

Add `--json` for machine-readable output. The exit code is 0 when the agent is live and 1 when it is not, so the tool works in CI: check your own agent on every deploy.

## What "live" means, and what it does not

"Live" means the agent **answered an unauthenticated caller the way a first request from a buyer would be answered**. That is a strict definition, on purpose:

- An agent behind a login (HTTP 401) is **private, not dead**. It reports `failureClass: "http"`, and the detail says so.
- An agent that answers but declines to quote, and publishes no menu of what it sells, is `no-menu`.
- A URL that still contains an unfilled template such as `{agentId}` can never be called. It is `unsafe-url`.
- A timeout is `transport`. Dolphin's scheduled prober retries on a backoff before counting an agent out; this command checks once.

## Where the code lives

This command runs Dolphin's own probe. It is not a copy that could drift:

- `convex/lib/probe.ts` — the probe;
- `convex/lib/erc8183.ts` — the A2A request and quote checks shared with real hires;
- `convex/lib/mcpClient.ts` — the MCP calls;
- `convex/lib/safeFetch.ts` — the guarded fetch;
- `convex/sources/scan8004.ts` — agent lookup through the public 8004scan API;
- `convex/lib/bscClient.ts` and `convex/model/agent.ts`.

## License

MIT (see `LICENSE`). The license covers this folder and the source files listed above.
