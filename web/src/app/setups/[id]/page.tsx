import type { Metadata } from "next";

import { SetupDetail } from "@/app/setups/setup-detail";
import { fetchSetups } from "@/server/convex";

/* Each setup by its own title (2026-10-19): every one was "Trading setup" and inherited the home page's canonical. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const setup = (await fetchSetups()).find((row) => row.id === id);
  if (!setup) return { title: "Trading setup", alternates: { canonical: `/setups/${id}` } };
  const description = setup.summary.length > 155 ? `${setup.summary.slice(0, 152).trimEnd()}…` : setup.summary;
  return { title: `${setup.title} — trading agent setup`, description, alternates: { canonical: `/setups/${id}` } };
}

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SetupDetail listingId={id} />;
}
