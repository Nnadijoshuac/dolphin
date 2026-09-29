/**
 * "By Dolphin": on every agent Dolphin itself operates (convex/lib/firstParty.ts).
 * A label, not a link - it sits inside agent cards that are links themselves.
 * The policy it refers to is at /policies/conflicts, linked from every footer.
 */
export function ByDolphin() {
  return (
    <span
      className="ml-2 inline-flex translate-y-[-2px] items-center rounded-full border border-line-strong px-2 py-0.5 align-middle text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-ink-soft"
      title="Operated by Dolphin - same probe, same rules, no ranking boost. See Conflicts of interest."
    >
      By Dolphin
    </span>
  );
}
