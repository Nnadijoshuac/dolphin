/**
 *   npx tsx --test tests/analytical-blocks.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeQuietEvent, parseFeed } from "../convex/lib/analyticalBlocks";

describe("news feed parsing", () => {
  it("reads RSS titles, sources and times, and nothing else", () => {
    const rss = `<rss><channel><item><title><![CDATA[CAKE jumps 8% as PancakeSwap volume climbs]]></title><link>https://www.example-news.com/a</link><pubDate>Mon, 29 Sep 2026 10:00:00 GMT</pubDate><description>Long body text that must never reach the model.</description></item></channel></rss>`;
    const [item] = parseFeed(rss);
    assert.equal(item.title, "CAKE jumps 8% as PancakeSwap volume climbs");
    assert.equal(item.source, "example-news.com");
    assert.equal(item.promo, null);
    assert.ok(!JSON.stringify(item).includes("Long body"));
  });

  it("flags paid promotion from the source's own markers - a press wire, or 'sponsored'", () => {
    const rss = `<rss><item><title>New token presale opens</title><link>https://www.globenewswire.com/x</link></item><item><title>Sponsored: best coin to buy now</title><link>https://blog.example.com/y</link></item></rss>`;
    const items = parseFeed(rss);
    assert.match(items[0].promo ?? "", /press-release wire/);
    assert.match(items[1].promo ?? "", /sponsored/);
  });

  it("reads a JSON news list", () => {
    const json = JSON.stringify({ results: [{ title: "BNB Chain upgrade ships", url: "https://news.example.org/z", published_at: "2026-09-29T09:00:00Z" }] });
    assert.equal(parseFeed(json)[0].title, "BNB Chain upgrade ships");
  });
});

describe("quiet hours", () => {
  const events = [{ label: "FOMC decision", at: "2026-10-28T18:00:00Z" }];
  it("stands aside within the margin either side of an event", () => {
    assert.equal(activeQuietEvent(events, 2, Date.parse("2026-10-28T16:30:00Z"))?.label, "FOMC decision");
    assert.equal(activeQuietEvent(events, 2, Date.parse("2026-10-28T19:59:00Z"))?.label, "FOMC decision");
  });
  it("trades normally outside it", () => {
    assert.equal(activeQuietEvent(events, 2, Date.parse("2026-10-28T12:00:00Z")), null);
  });
});

describe("quiet hours on the trade path", () => {
  it("refuses a swap proposal during an event's window - in code, whatever the Brain decides", async () => {
    const { runBlockTool } = await import("../convex/lib/agentBlocks");
    const now = new Date().toISOString();
    const blocks = [
      { id: "risk", type: "risk", config: { maxTradeUsd: 50, maxTradesPerDay: 5 } },
      { id: "swap", type: "swap", config: {} },
      { id: "quiet", type: "quietHours", config: { events: [{ label: "CPI release", at: now }], marginHours: 2 } },
    ] as never;
    const result = await runBlockTool(blocks, "block_propose_swap", JSON.stringify({ sellSymbol: "USDT", buySymbol: "CAKE", sellAmount: "5", reason: "test" }), 0);
    assert.equal(result.isError, true);
    assert.match(result.text, /quiet hours - standing aside within 2h of "CPI release"/);
  });
});
