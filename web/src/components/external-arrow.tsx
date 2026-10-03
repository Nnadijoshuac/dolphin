/**
 * The "opens elsewhere" mark (owner, 2026-10-03, after nextra.site): a drawn arrow in a box as tall
 * as the text (1em), stroke 1.7, centred on the line - measured from Nextra's own, not the ↗
 * character, so it is the same size and weight in every font.
 */
export function ExternalArrow() {
  return (
    <svg aria-hidden className="ext-arrow" fill="none" viewBox="0 0 24 24">
      <path d="M7 17 17 7M7 7h10v10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
