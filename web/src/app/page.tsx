import type { Metadata } from "next";

import { DiscoverPage } from "@/app/home-client";
import { JsonLd } from "@/components/json-ld";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/constants/site";

/**
 * The server shell around the home screen, for its metadata and structured data (see app/search/page.tsx
 * for the pattern). The canonical used to sit on the ROOT LAYOUT, where every page without its own
 * inherited it - so /live and every live run told search engines they were copies of the home page
 * (measured on prod, 2026-10-19). It belongs here, on the one page it is true of.
 */
export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      {/*
        Who Dolphin is, as a search engine reads it: one Organization and one WebSite, so the name
        "Dolphin" resolves to this site and not to the emulator or the film company that share it.
      */}
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "@id": `${SITE_URL}/#organization`,
            name: SITE_NAME,
            alternateName: ["Dolphin AI agent marketplace", "Dolphin agents", "dolphinamp"],
            url: SITE_URL,
            logo: `${SITE_URL}/dolphin-logo.png`,
            description: SITE_DESCRIPTION,
            sameAs: ["https://github.com/Nnadijoshuac/dolphin", "https://t.me/dolphinamp_traders"],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            name: SITE_NAME,
            alternateName: "Dolphin AI agent marketplace",
            url: SITE_URL,
            publisher: { "@id": `${SITE_URL}/#organization` },
            potentialAction: {
              "@type": "SearchAction",
              target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
              "query-input": "required name=search_term_string",
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Dolphin AI agent marketplace",
            url: SITE_URL,
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            description: SITE_DESCRIPTION,
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
        ]}
      />
      <DiscoverPage />
    </>
  );
}
