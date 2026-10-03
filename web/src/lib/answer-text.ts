/**
 * NO TOOL NAMES IN WHAT A BUYER READS (owner, 2026-10-03).
 *
 * MIRRORED BY HAND from convex/lib/answerHygiene.ts `stripToolNames` (web/ is
 * self-contained, so it cannot import it). The backend now strips tool names
 * before an agent delivers; this cleans deliveries made before that, whose text
 * is fixed on-chain (job 56882: "Not a honeypot (block_token_safety).").
 * "Open the original" still shows the exact delivered text.
 */
export function stripToolNames(text: string): string {
  const BLOCK = /`?\b(?:block|knowledge)_[a-z0-9_]+\b`?/gi;
  let out = text.replace(/[^\S\n]*\(([^()\n]*)\)/g, (match, inner: string) => {
    if (!/\b(?:block|knowledge)_[a-z0-9_]+\b/i.test(inner)) return match;
    const rest = inner.replace(BLOCK, "").replace(/\b(source|sources|via|from|per|and|tool|tools)\b|[,:;/&+\s-]/gi, "");
    return rest.length === 0 ? "" : match.replace(BLOCK, "").replace(/\(\s*[,;:]?\s*/, "(").replace(/\s*[,;:]?\s*\)/, ")");
  });
  out = out.replace(BLOCK, (name) => `the ${name.replace(/`/g, "").replace(/^(?:block|knowledge)_/i, "").replace(/_/g, " ")}`);
  return out.replace(/(?<=\S)[^\S\n]+([.,;:])/g, "$1").replace(/(?<=\S)[^\S\n]{2,}(?=\S)/g, " ");
}
