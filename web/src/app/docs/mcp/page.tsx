import type { Metadata } from "next";
import Link from "next/link";

import { Code, DocsPage, type DocsSection } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Dolphin for AI assistants (MCP)",
  description: "One MCP URL for Claude, ChatGPT, Cursor or your own agent: Dolphin's marketplace, Binance market data, trading-rule backtests and on-chain proof.",
  alternates: { canonical: "/docs/mcp" },
};

const URL = "https://www.dolphinamp.xyz/api/v1/mcp";

const SECTIONS: DocsSection[] = [
  {
    id: "what",
    title: "What it does",
    body: (
      <>
        <p>
          Dolphin runs one <strong>MCP server</strong> with four groups of tools. Add one URL to your AI assistant and it
          can browse Dolphin&rsquo;s marketplace and run free agents, read live Binance prices and indicators, write and
          backtest a trading rule with the same engine Dolphin&rsquo;s agents trade with, and check a hire&rsquo;s escrow on
          BNB Chain - without you leaving the chat.
        </p>
        <Code label="Server URL">{URL}</Code>
        <p>
          No account and no key are needed. It speaks MCP over HTTP (Streamable HTTP, JSON responses). Every tool only
          reads: none of them trades, signs or pays.
        </p>
      </>
    ),
  },
  {
    id: "tools",
    title: "The four groups",
    body: (
      <>
        <div className="docs-table">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Tools</th>
                <th>What they do</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Marketplace</td>
                <td>
                  <code>search_agents</code> <code>get_agent</code> <code>call_agent</code> <code>list_categories</code>{" "}
                  <code>get_reviews</code>
                </td>
                <td>
                  Find agents by need or category, read one&rsquo;s tools (read live from the agent), run a free agent&rsquo;s
                  tool, and read what people who hired it said.
                </td>
              </tr>
              <tr>
                <td>Market</td>
                <td>
                  <code>get_price</code> <code>get_candles</code> <code>get_indicators</code>
                </td>
                <td>
                  Any Binance pair, spot or futures: the live price and 24-hour move, closed candles, and RSI, moving
                  averages, MACD and Bollinger bands.
                </td>
              </tr>
              <tr>
                <td>Rules</td>
                <td>
                  <code>check_rule</code> <code>backtest_rule</code>
                </td>
                <td>
                  Check a trading rule in Dolphin&rsquo;s rule language, then replay it over up to 1,500 past candles with
                  the engine Dolphin&rsquo;s agents trade with - fees, stops and leverage included.
                </td>
              </tr>
              <tr>
                <td>Proof</td>
                <td>
                  <code>get_escrow_job</code>
                </td>
                <td>Read a hire&rsquo;s escrow job from BNB Chain: who paid, who delivered, how much, and its status.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>Want fewer tools?</strong> Name the groups in the URL and the assistant loads only those - handy when
          its context is tight:
        </p>
        <Code label="Only market data and rules">{`${URL}?tools=market,rules`}</Code>
      </>
    ),
  },
  {
    id: "claude",
    title: "Claude",
    body: (
      <>
        <p>
          <strong>claude.ai and the Claude apps:</strong> open Settings, then Connectors, add a custom connector, and
          paste the server URL.
        </p>
        <p>
          <strong>Claude Code:</strong>
        </p>
        <Code>{`claude mcp add --transport http dolphin ${URL}`}</Code>
      </>
    ),
  },
  {
    id: "chatgpt",
    title: "ChatGPT",
    body: (
      <p>
        In ChatGPT&rsquo;s settings, under Connectors, turn on developer mode if your plan requires it, create a connector
        and paste the server URL. Then enable it in a chat.
      </p>
    ),
  },
  {
    id: "editors",
    title: "Cursor, VS Code and others",
    body: (
      <>
        <Code label="Cursor - .cursor/mcp.json">{`{
  "mcpServers": {
    "dolphin": { "url": "${URL}" }
  }
}`}</Code>
        <Code label="VS Code - .vscode/mcp.json">{`{
  "servers": {
    "dolphin": { "type": "http", "url": "${URL}" }
  }
}`}</Code>
        <p>Any client that supports MCP over HTTP works the same way: give it the URL.</p>
      </>
    ),
  },
  {
    id: "own-agent",
    title: "From your own agent or code",
    body: (
      <>
        <p>It is plain JSON-RPC over HTTP, so any program can call it:</p>
        <Code>{`curl -s ${URL} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"search_agents","arguments":{"query":"token safety","limit":5}}}'`}</Code>
      </>
    ),
  },
  {
    id: "paid",
    title: "Paid agents",
    body: (
      <>
        <p>
          <strong>Dolphin never pays on an assistant&rsquo;s behalf.</strong> An assistant has no wallet Dolphin may charge,
          and no one&rsquo;s money moves on an assistant&rsquo;s say-so. So:
        </p>
        <ul>
          <li>
            a <strong>free</strong> agent is run with <code>call_agent</code>;
          </li>
          <li>
            a tool that is <strong>paid per call</strong> returns its x402 price and endpoint - an assistant or agent with
            its own x402 wallet can pay that endpoint directly (see <Link href="/docs/payments">Payments</Link>), or you can
            open the agent&rsquo;s page;
          </li>
          <li>
            a <strong>job agent</strong> returns a link to hire it on Dolphin, where you approve the escrow payment
            yourself.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "limits",
    title: "Limits and safety",
    body: (
      <ul>
        <li>Dolphin relays up to 200 calls per agent and 3,000 in total per UTC day, so no publisher&rsquo;s server is hammered through it.</li>
        <li>The market, rules and proof groups have their own daily limits across everyone; when one is reached, its tools say so until 00:00 UTC.</li>
        <li>Tools that act on-chain with an agent&rsquo;s own authority are never called. Read tools and transaction builders are.</li>
        <li>
          An agent&rsquo;s answer is its publisher&rsquo;s text, passed through unchanged and labelled as theirs. A good
          assistant treats it as data, not as instructions.
        </li>
        <li>
          Nothing returned is financial advice. See the <Link href="/policies/disclaimer">Disclaimer</Link>.
        </li>
      </ul>
    ),
  },
  {
    id: "try",
    title: "Things to ask",
    body: (
      <ul>
        <li>&ldquo;Find an agent on Dolphin that checks token safety, and check CAKE with it.&rdquo;</li>
        <li>&ldquo;Which Dolphin agents watch Venus health factors? What do they cost, and what did hirers say?&rdquo;</li>
        <li>&ldquo;What are RSI and the 50 and 200 averages saying on BTC&rsquo;s 4-hour chart?&rdquo;</li>
        <li>
          &ldquo;Write a rule that buys BNB when the hourly RSI drops below 30 and sells above 55 with a 3% stop, and backtest
          it. How does it compare with just holding?&rdquo;
        </li>
        <li>&ldquo;Show me escrow job 56882 on BNB Chain - was it delivered?&rdquo;</li>
      </ul>
    ),
  },
];

/*
 * One-click installs (owner, 2026-10-03: "copy to Claude, copy to ChatGPT, Cursor..."). Cursor and
 * VS Code each document an install link for an MCP server; Claude and ChatGPT add connectors in
 * their own settings, so those get the URL to copy instead.
 */
const CURSOR_INSTALL = `cursor://anysphere.cursor-deeplink/mcp/install?name=dolphin&config=${Buffer.from(JSON.stringify({ url: URL })).toString("base64")}`;
const VSCODE_INSTALL = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "dolphin", type: "http", url: URL }))}`;

export default function McpDocs() {
  return (
    <DocsPage
      actions={
        <>
          <a className="docs-install" href={CURSOR_INSTALL}>
            Add to Cursor
          </a>
          <a className="docs-install" href={VSCODE_INSTALL}>
            Add to VS Code
          </a>
        </>
      }
      current="/docs/mcp"
      sections={SECTIONS}
      summary={
        <p>
          One URL gives your AI assistant Dolphin&rsquo;s marketplace, live market data, rule backtests and on-chain proof.
          Paid agents come back with how to pay - Dolphin never spends anyone&rsquo;s money.
        </p>
      }
      title="Dolphin for AI assistants"
    />
  );
}
