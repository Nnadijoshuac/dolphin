import type { Metadata } from "next";

import { SetupDetail } from "@/app/setups/setup-detail";

export const metadata: Metadata = { title: "Trading setup" };

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SetupDetail listingId={id} />;
}
