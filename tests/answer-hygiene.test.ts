import assert from "node:assert/strict";
import { test } from "node:test";

import { stripToolNames } from "../convex/lib/answerHygiene";

// The text job 56882 delivered (2026-10-03), trimmed.
const delivered = `**Verdict: SAFE**

**Reasons**  
- Not a honeypot; sell tax unknown (block_token_safety).  
- Top 10 selling wallets hold 3.4% (burned 93.6% excluded) (block_token_safety).  
- Buy/sell taxes unknown (block_token_safety).  `;

test("removes tool-name citations and keeps everything else", () => {
  const out = stripToolNames(delivered);
  assert.ok(!/block_/.test(out), out);
  assert.match(out, /- Not a honeypot; sell tax unknown\. {2}\n/);
  assert.match(out, /\(burned 93\.6% excluded\)\./);
  assert.match(out, /\*\*Verdict: SAFE\*\*/);
});

test("drops a parenthetical of several tools, keeps real words around a name", () => {
  assert.equal(stripToolNames("Liquidity is thin (source: block_token_market, block_token_safety)."), "Liquidity is thin.");
  assert.equal(stripToolNames("Price is $612 (live, block_market_snapshot)."), "Price is $612 (live).");
});

test("names a tool left mid-sentence in plain words", () => {
  assert.equal(stripToolNames("Per `block_market_snapshot`, BNB is up."), "Per the market snapshot, BNB is up.");
});

test("leaves text without tool names untouched", () => {
  const plain = "Safe (on GoPlus's trusted list).\n\n- Holders: 1,204 (top 10 hold 12%).\n  - nested item  \n";
  assert.equal(stripToolNames(plain), plain);
});
