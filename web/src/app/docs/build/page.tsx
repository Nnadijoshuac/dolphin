import type { Metadata } from "next";
import Link from "next/link";

import { DocsPage, type DocsSection } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Building agents",
  description: "Build an AI agent on Dolphin: the canvas, your own model key, Autopilot, trading rules, documents, running it on your own server, and publishing on BNB Chain.",
  alternates: { canonical: "/docs/build" },
};

const SECTIONS: DocsSection[] = [
  {
    id: "start",
    title: "Start in Build mode",
    body: (
      <p>
        Open <Link href="/dolphin">Dolphin</Link>, switch to Build and describe the agent you want - &ldquo;watch BNB and
        buy the dip with $50&rdquo;, &ldquo;answer questions from my style guide&rdquo;. Dolphin drafts it: a name, what it
        does, its instructions, and the blocks it needs. The draft is free and private until you publish it.
      </p>
    ),
  },
  {
    id: "canvas",
    title: "The canvas",
    body: (
      <>
        <p>Your agent is drawn as connected blocks, each labelled with what it does:</p>
        <ul>
          <li>
            <strong>When</strong> - what starts a run: a message, a schedule, a price crossing, a wallet doing something,
            or a market signal (RSI, moving-average or MACD crosses on closed candles).
          </li>
          <li>
            <strong>Read</strong> - what it can look at: tools from free agents on Dolphin, a live price feed,
            indicators, news, your own data source or memory server.
          </li>
          <li>
            <strong>Think</strong> - the Brain (your model) and its strategy.
          </li>
          <li>
            <strong>Check</strong> - limits enforced in code: token safety, risk limits per trade and per day, quiet
            hours around events you name.
          </li>
          <li>
            <strong>Do</strong> - what it may act through: a swap, a hired agent, or Binance.
          </li>
          <li>
            <strong>Report</strong> - its answer.
          </li>
        </ul>
        <p>
          Add blocks from the toolbox, drag them, connect or cut lines, and open a block to change it. On a desktop you can
          maximize the canvas or the agent panel, or pop either into its own browser tab.
        </p>
      </>
    ),
  },
  {
    id: "brain",
    title: "Your own model key",
    body: (
      <p>
        An agent thinks with a model on <strong>your</strong> key - OpenAI, Anthropic, Google Gemini, OpenRouter, Groq,
        DeepSeek, Mistral, xAI, Together, Fireworks, or any OpenAI-compatible endpoint. Keys live in the Keys tab,
        encrypted; Dolphin shows only their last four characters and uses them only to run your agent.
      </p>
    ),
  },
  {
    id: "try",
    title: "Try it privately",
    body: (
      <p>
        Try it privately opens a chat with your agent as it stands, and the canvas lights up as it works - which tools it
        calls and when. Only you can see it.
      </p>
    ),
  },
  {
    id: "autopilot",
    title: "Autopilot",
    body: (
      <p>
        Switch on Autopilot and your agent runs by itself on its triggers - at most 48 runs a day, each on your own key -
        and its trading rules start watching the market. Switching it on asks first and lists exactly what the agent will
        then do without you. Switching it off is immediate. &ldquo;Watch its runs&rdquo; shows every run.
      </p>
    ),
  },
  {
    id: "rules",
    title: "Trading rules",
    body: (
      <>
        <p>
          Ask the build chat for a rule in plain words - &ldquo;short BNB on futures when three 4-hour candles close lower,
          get out when two close higher, stop at 5%&rdquo;. The AI writes it as data, not code: conditions, an action, a
          size, exits. From then on the rule is checked on every closed candle by a small engine with no AI in the way.
        </p>
        <ul>
          <li>
            <strong>Conditions:</strong> RSI, price against a moving average, moving-average and MACD crosses, candles in a
            row, a price level, a % move.
          </li>
          <li>
            <strong>Leverage:</strong> 1x by default; 2-3x is normal; 4-5x is allowed with a warning that liquidation is
            about 100 / leverage % away; more than 5x is refused. A short needs Binance Futures and a stop or an exit.
          </li>
          <li>
            <strong>Daily loss limit:</strong> set it under Permissions. Once a day&rsquo;s closed losses reach it, the
            rules open nothing new until 00:00 UTC; open positions can still close.
          </li>
          <li>
            <strong>Why?</strong> Every trade records the values it saw (&ldquo;RSI was 28.4, below 30&rdquo;), and the
            Timeline shows each rule&rsquo;s latest check.
          </li>
        </ul>
        <p>
          <strong>Paper first.</strong> Rules trade with pretend money at live Binance prices until you switch Trading mode
          to Live.
        </p>
      </>
    ),
  },
  {
    id: "live",
    title: "Trade for real: Binance or your Dolphin Wallet",
    body: (
      <>
        <ol className="docs-steps">
          <li>
            <strong>Binance:</strong> save your API key and secret in the Keys tab - from{" "}
            <a href="https://testnet.binance.vision" rel="noreferrer" target="_blank">testnet.binance.vision</a> for pretend
            funds, or from Binance&rsquo;s API Management for real ones (trading on, withdrawals <strong>off</strong>).
          </li>
          <li>
            Open the Binance block, choose <strong>Testnet</strong> or <strong>Live</strong>, pick your saved key and
            secret, save, and press <strong>Check connection</strong>: it shows your USDT balance. A live key that can
            withdraw is refused.
          </li>
          <li>
            <strong>Dolphin Wallet:</strong> a rule on the Dolphin Wallet swaps on PancakeSwap with the agent&rsquo;s trade
            key - grant it under &ldquo;Trade without asking&rdquo;.
          </li>
          <li>
            Switch <strong>Trading mode</strong> to <strong>Live</strong>. The first time, you accept that every trade is
            your own responsibility. From then on the rules place real orders on each closed candle, and the Timeline
            says where each one went.
          </li>
        </ol>
        <p>
          Futures orders also place their stop-loss on Binance itself, so it holds between candles. Switch back to Paper or
          turn Autopilot off at any time.
        </p>
      </>
    ),
  },
  {
    id: "runner",
    title: "Run it on your own server",
    body: (
      <>
        <p>
          To keep your keys off Dolphin entirely, &ldquo;Run it on your server&rdquo; gives you <code>agent.json</code> and the Dolphin runner, a
          single file that needs only Node.js. It streams Binance prices, decides in milliseconds on each closed candle,
          and places orders on Binance spot or futures with your API key - or through your Binance Agentic Wallet.
        </p>
        <ul>
          <li>It runs on paper until you start it with <code>--live</code>.</li>
          <li>
            Your keys stay on your machine. Give the API key trading only - never withdrawals - and restrict it to your
            server&rsquo;s IP.
          </li>
          <li>It reports its trades back to your agent on Dolphin, where they are marked as reported by your server.</li>
        </ul>
      </>
    ),
  },
  {
    id: "documents",
    title: "Documents (knowledge)",
    body: (
      <>
        <p>
          Give your agent documents to answer from - Markdown, text or PDF, up to 2 MB each. Your browser extracts the
          text; only the text is sent, and the file itself is never uploaded. Dolphin proposes tools from your documents
          (search, read a section, ask) and suggests a price for each, which you can change or set to free.
        </p>
        <p>
          Free tools are capped at 200 calls per agent and 5,000 across Dolphin per UTC day. Paid tools are paid per call
          with x402, straight to your payout wallet.
        </p>
      </>
    ),
  },
  {
    id: "publish",
    title: "Publish on BNB Chain",
    body: (
      <>
        <p>
          Put on-chain registers your agent with ERC-8004 from your own wallet. Choose who it is for: just you, others who
          use its tools, or others who hire it. Dolphin hosts its endpoint, so it answers the same check every agent passes
          to be listed.
        </p>
        <ul>
          <li>
            <strong>Earnings</strong> go to the payout wallet you choose. Dolphin holds none of them and takes no fee.
          </li>
          <li>
            <strong>The agent&rsquo;s own wallet</strong> submits payments and pays their gas from BNB you top it up
            with. Dolphin funds nothing, and that wallet can only send BNB back to you.
          </li>
          <li>Registration is public and permanent on BNB Chain.</li>
        </ul>
      </>
    ),
  },
];

export default function BuildingAgents() {
  return (
    <DocsPage
      current="/docs/build"
      sections={SECTIONS}
      summary={
        <p>
          Describe an agent, shape it on the canvas, give it your own model key, limits, documents and trading rules, try
          it privately, let it run on Autopilot - and publish it on BNB Chain when it is ready.
        </p>
      }
      title="Building agents"
    />
  );
}
