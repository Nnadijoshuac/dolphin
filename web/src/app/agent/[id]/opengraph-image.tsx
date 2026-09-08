import { ImageResponse } from "next/og";

import { categoryLabel } from "@/constants/agents";
import { fetchAgent } from "@/server/convex";

/**
 * The social card for one agent.
 *
 * ===========================================================================
 * WHY GENERATE ONE PER AGENT (2026-09-08)
 * ===========================================================================
 * There were no OpenGraph tags at all, so every agent link pasted into Slack,
 * Telegram, X or Discord unfurled as bare text - or as nothing. On a product
 * whose distribution is people sending each other links to specific agents,
 * that is the difference between a link that sells the record and a link that
 * looks like a broken URL.
 *
 * ===========================================================================
 * WHAT IS ON IT, AND WHAT IS DELIBERATELY NOT
 * ===========================================================================
 * The agent's NAME, its CATEGORY and its ERC-8004 TOKEN ID. Those three are
 * stable identity: they do not change between the moment the card is cached by
 * a messaging platform and the moment someone clicks it, possibly weeks later.
 *
 * NO LIVE METRIC appears here - no APY, no health factor, no P&L. A social card
 * is cached indefinitely by every platform that renders it and carries no
 * timestamp and no source, which makes it the one surface in this product where
 * a number CANNOT be shown with its provenance. Putting "12.4% APY" on a card
 * that will still be circulating in a month is exactly the failure AGENTS.md
 * SS5 describes, and it would be the most-seen instance of it.
 */

export const alt = "Dolphin agent record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * Cached for a day. The identity on this card changes almost never, and
 * regenerating a PNG on every unfurl - platforms re-fetch aggressively - is
 * work with no beneficiary.
 */
export const revalidate = 86_400;

const CANVAS = "#f4f3ed";
const INK = "#171813";
const MUTED = "#5f6058";
const FAINT = "#6a6b62";
const ACCENT = "#f0b90b";
const LINE = "#deddd4";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await fetchAgent(id);

  /*
   * A card is rendered even when the record cannot be read. An unfurl that
   * fails leaves the platform showing nothing at all, which looks like a dead
   * link; a branded card with no claims on it does not.
   */
  const name = agent?.name ?? "Agent record";
  const label = agent ? categoryLabel(agent.category) : "ERC-8004";
  const tokenId = agent?.tokenId ?? null;
  const tagline = agent?.tagline?.trim() ?? "";
  const summary =
    tagline.length > 120 ? `${tagline.slice(0, 117).trimEnd()}…` : tagline;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CANVAS,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: MUTED,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: ACCENT,
              }}
            />
            <span>Dolphin</span>
            <span style={{ color: LINE }}>/</span>
            <span>{label}</span>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 40,
              fontSize: name.length > 28 ? 68 : 88,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1.05,
              color: INK,
            }}
          >
            {name}
          </div>

          {summary ? (
            <div
              style={{
                display: "flex",
                marginTop: 28,
                maxWidth: 900,
                fontSize: 30,
                lineHeight: 1.4,
                color: MUTED,
              }}
            >
              {summary}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 28,
            fontSize: 24,
            color: FAINT,
          }}
        >
          <span>{tokenId ? `ERC-8004 #${tokenId}` : "ERC-8004 registry"}</span>
          <span>BNB Smart Chain</span>
        </div>
      </div>
    ),
    size,
  );
}
