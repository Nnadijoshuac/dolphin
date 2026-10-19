/**
 * Structured data for search engines, rendered on the server so a crawler that runs no JavaScript still
 * reads it. `<` is escaped so a publisher's own text (an agent name, a tagline) can never close the script.
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\u003c") }} type="application/ld+json" />;
}
