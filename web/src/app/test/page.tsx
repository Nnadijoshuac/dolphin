import type { Metadata } from "next";

import { parseArgs, toQuery } from "@/app/test/choices";
import { StrategyTest } from "@/app/test/strategy-test";

const CARD_VERSION = "art2";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/*
 * The link people share. Its preview is the result card for exactly these choices (test/card), so a
 * strategy pasted into X or WhatsApp unfurls with its own number, window and "fees counted".
 */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const args = parseArgs(await searchParams);
  // CARD_VERSION changes whenever the card's design does: X and WhatsApp cache a preview by its image URL,
  // so a new version makes every new share fetch the new design instead of a week-old copy.
  const card = `/test/card?${toQuery(args)}&v=${CARD_VERSION}`;
  const title = "Would your strategy have survived?";
  const description = "Pick a coin, when to buy and when to sell. See what it would have made over the last year, against just holding, fees counted.";
  return {
    title,
    description,
    alternates: { canonical: "/test" },
    openGraph: { title, description, url: `/test?${toQuery(args)}`, images: [{ url: card, width: 1200, height: 630, type: "image/jpeg", alt: title }] },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

export default async function TestPage({ searchParams }: { searchParams: SearchParams }) {
  const args = parseArgs(await searchParams);
  return <StrategyTest initial={args} />;
}
