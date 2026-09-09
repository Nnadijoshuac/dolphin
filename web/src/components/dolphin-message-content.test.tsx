import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DolphinMessageContent } from "./dolphin-message-content";

describe("DolphinMessageContent", () => {
  const sampleMessage = `The PancakeSwap Grid Trader (agent \`a2\`) is the live, verified trading bot in the marketplace that best matches a “good” on‑chain strategy right now. It implements a configurable geometric grid on PancakeSwap v3 pools, letting you set the token pair, fee tier, price range, number of levels and size per level. All of its tools are read‑only, so you can inspect the grid’s state and simulate the next order without spending any gas (the only paid call is \`a2__report\`, which costs a small x402 fee in USDT).

**What you can do right now**

- **Check if the agent is reachable** – I can ping its endpoint instantly to confirm it’s live.
- **See an existing grid** – If you already have a gridId (and optionally chainId), just give it to me and I’ll pull the latest \`analyse\` (free) or \`state\` (free) to show you the current layout, filled levels, next trigger and realised P&L.
- **Start a new grid** – Provide:
  1. Token0 and token1 contract addresses (the pair you want to trade)
  2. Fee tier (100, 500, 2500 or 10000)
  3. Lower and upper price (in token1 per token0)
  4. Number of levels (2‑200)
  5. Size per level (amount of token1 to spend per buy, as a string)

With those parameters I can:
- Initialise the grid via \`a2__analyse\` (create‑on‑first‑call),
- Return the current state,
- Optionally run \`a2__report\` to simulate the exact next order (quote, effective price, impact).

**Why this bot stands out**

- **Live and verified** – The agent’s endpoint is currently reachable on BSC mainnet; the marketplace filters out the ~300k spam/template registrations, so you’re seeing only the ~28 agents that actually respond.
- **Transparent data** – Every number you see comes directly from the agent’s MCP tools in this conversation; I attribute them naturally and never guess.
- **Risk‑aware** – Grid trading profits in ranging markets and can suffer inventory drawdowns in strong trends. The bot itself doesn’t add leverage or borrow; risk comes from the price moving outside your grid, which you can monitor via the \`analyse\`/\`state\` calls.

Let me know whether you’d like me to verify the agent’s liveness first, or share the details of a grid you already have (or want to create). I’ll fetch the live data and walk you through the current setup.`;

  it("renders without displaying bare asterisks '**'", () => {
    const html = renderToStaticMarkup(<DolphinMessageContent content={sampleMessage} />);
    // Ensure no raw "**" appears in the rendered markup
    expect(html).not.toContain("**");
  });

  it("hyperlinks 'The PancakeSwap Grid Trader' to its agent page", () => {
    const html = renderToStaticMarkup(<DolphinMessageContent content={sampleMessage} />);
    expect(html).toContain(
      `href="/agent/${encodeURIComponent("56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338477")}"`
    );
    expect(html).toContain("The PancakeSwap Grid Trader</a>");
  });

  it("renders inline code elements for `a2` and `a2__report`", () => {
    const html = renderToStaticMarkup(<DolphinMessageContent content={sampleMessage} />);
    expect(html).toContain(">a2</code>");
    expect(html).toContain(">a2__report</code>");
  });

  it("renders headers cleanly as headings", () => {
    const html = renderToStaticMarkup(<DolphinMessageContent content={sampleMessage} />);
    expect(html).toContain("What you can do right now");
    expect(html).toContain("Why this bot stands out");
  });
});
