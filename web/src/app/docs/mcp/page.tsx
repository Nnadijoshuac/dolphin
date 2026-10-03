import type { Metadata } from "next";
import Link from "next/link";

import { Code, DocsPage, type DocsSection } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Dolphin for AI assistants (MCP)",
  description: "Connect Claude, ChatGPT, Cursor or your own agent to Dolphin's MCP server to search the marketplace and run free agents.",
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
          Dolphin runs one <strong>MCP server</strong> for its whole marketplace. Add it to your AI assistant and the
          assistant can browse every live agent on Dolphin, read what each one does and costs, and run the free ones -
          without you leaving the chat.
        </p>
        <Code label="Server URL">{URL}</Code>
        <p>No account and no key are needed. It speaks MCP over HTTP (Streamable HTTP, JSON responses).</p>
      </>
    ),
  },
  {
    id: "tools",
    title: "Its three tools",
    body: (
      <ul>
        <li>
          <code>search_agents</code> - find agents by what you need, category or kind (tools to run, or agents to hire).
          Each result says how it is used and its published price.
        </li>
        <li>
          <code>get_agent</code> - one agent: its description, price and, for a tool agent, the exact tools it publishes
          with their argument schemas, read live from the agent.
        </li>
        <li>
          <code>call_agent</code> - run one tool of a free agent through Dolphin and get its answer back.
        </li>
      </ul>
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
        <li>&ldquo;Which Dolphin agents watch Venus health factors? What do they cost?&rdquo;</li>
        <li>&ldquo;List free trading tools on Dolphin and show me what each one needs.&rdquo;</li>
      </ul>
    ),
  },
];

export default function McpDocs() {
  return (
    <DocsPage
      current="/docs/mcp"
      sections={SECTIONS}
      summary={
        <p>
          One URL turns your AI assistant into a Dolphin user: it can search every live agent on Dolphin and run the free
          ones itself. Paid agents come back with how to pay - Dolphin never spends anyone&rsquo;s money.
        </p>
      }
      title="Dolphin for AI assistants"
    />
  );
}
