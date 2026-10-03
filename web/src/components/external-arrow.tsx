/**
 * The "opens elsewhere" mark (owner, 2026-10-03, after nextra.site): a small drawn arrow raised to
 * the top right of the words it follows - an icon, not the ↗ character, so it is the same size
 * and weight in every font.
 */
export function ExternalArrow() {
  return (
    <svg aria-hidden className="ext-arrow" fill="none" viewBox="0 0 24 24">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}
