/**
 * Keeping raw machine output out of what a person reads.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-26)
 * ---------------------------------------------------------------------------
 * Asked "Check Venus liquidation health", Dolphin answered with:
 *
 *   I queried the Venus Liquidation Guard agent for your wallet ... and it
 *   returned:
 *   ``
 *   { "error": "no-markets", "detail": "0x1345... has entered no Venus
 *     markets on chain 56: there is no position to watch." }
 *   ``
 *
 * The owner's rule, verbatim: never put an error out to the user. That JSON
 * was not even an error in the person's terms. It is a FINDING ("you have no
 * Venus position"), in a stranger's wire format. Dolphin's job is to say what
 * it means, and the model on a free tier copies whatever it is shown.
 *
 * Two functions, one on each side of the model:
 *
 *   - `digestToolResult` rewrites what the model is SHOWN, so an agent's
 *     `{"error": ...}` arrives as a sentence about the user's situation
 *     rather than a payload to paste.
 *   - `stripRawPayloads` cleans what the model WROTE, as the last line: a JSON
 *     or code block that slipped through is removed before anyone sees it or it
 *     is cached. The evidence is not lost - the raw result stays in
 *     `dolphinToolCalls.resultText`, behind the "Consulted" disclosure.
 */

/** Plain, short. What a person would call the thing, not a field name. */
function readableField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * What the model is shown for one tool's answer.
 *
 * JSON with an `error` member becomes a sentence. The agent's `detail` (or
 * `message`) is kept because it is usually the useful part ("has entered no
 * Venus markets"), and the code is kept in parentheses only as a hint for the
 * model's interpretation, never as something to quote. Anything else passes
 * through unchanged.
 */
export function digestToolResult(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return text;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return text;

  const record = parsed as Record<string, unknown>;
  const code = readableField(record.error) ?? readableField(record.code);
  if (!code) return text;

  const detail =
    readableField(record.detail) ??
    readableField(record.message) ??
    readableField(record.reason);

  /*
   * The code is withheld whenever there is a readable reason. Measured
   * 2026-09-26: shown "(its code: no-markets)" with an instruction not to
   * quote it, the model quoted it anyway. It cannot quote what it never sees.
   */
  return (
    `The agent could not produce the usual result, and said why: ${detail ?? code}. ` +
    "This is usually a finding about the user's situation, not a fault. " +
    "Explain what it means in plain words, without quoting it."
  );
}

/** Words that change nothing about what is being asked. */
const FILLER = new Set(["a", "an", "the", "my", "me", "for", "please", "can", "you", "again", "now", "of", "on", "is", "what", "whats"]);

function questionWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/0x[a-f0-9]{40}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !FILLER.has(word));
}

/**
 * The earlier question in this conversation that `text` repeats, if any.
 *
 * Measured 2026-09-26: "Check Venus liquidation health for 0x1345..." then
 * "Check Venus liquidation health" got the same answer twice, word for word,
 * although the prompt told the model not to repeat itself. So the repeat is
 * detected here and stated to the model outright.
 *
 * Same question = the same meaningful words (addresses and filler ignored),
 * or one question's words wholly containing the other's, or 80% overlap.
 * Deliberately strict: a follow-up that adds anything real is not a repeat.
 */
export function findEarlierSameQuestion(
  text: string,
  earlierQuestions: readonly string[],
): string | null {
  const current = questionWords(text);
  if (current.length < 2) return null;
  const currentSet = new Set(current);

  for (let index = earlierQuestions.length - 1; index >= 0; index--) {
    const earlier = questionWords(earlierQuestions[index]);
    if (earlier.length < 2) continue;
    const earlierSet = new Set(earlier);

    const shared = [...currentSet].filter((word) => earlierSet.has(word)).length;
    const union = new Set([...currentSet, ...earlierSet]).size;
    // Only THIS question falling inside the earlier one counts: a follow-up
    // that adds words ("... and how much should I repay") asks for more.
    const alreadyAsked = shared === currentSet.size;

    if (alreadyAsked || shared / union >= 0.8) return earlierQuestions[index];
  }
  return null;
}

/** Whether a block of text is structured data rather than prose. */
function looksLikeData(block: string): boolean {
  const trimmed = block.trim();
  if (!/^[{[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Truncated or loosely formatted JSON still counts if it has key: value pairs.
    return /"[\w-]+"\s*:/.test(trimmed);
  }
}

/**
 * Removes JSON and code blocks from a reply meant for a person.
 *
 * Handles fences of two or more backticks (the leak above used two, which no
 * markdown renderer treats as a fence, so it rendered as literal text) and bare
 * multi-line JSON on its own lines. Inline `single-backtick` spans are left
 * alone: those are how an answer names a function or a token symbol.
 */
export function stripRawPayloads(text: string): string {
  let out = text.replace(/(`{2,})[a-z]*[^\S\n]*\n?([\s\S]*?)\1/gi, (match, _fence, inner: string) =>
    looksLikeData(inner) || inner.includes("\n") ? "" : match,
  );

  out = out.replace(/^[^\S\n]*[{[][^\n]*\n(?:[^\n]*\n)*?[^\S\n]*[}\]][^\S\n]*$/gm, (match) =>
    looksLikeData(match) ? "" : match,
  );

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * NO TOOL NAMES IN AN ANSWER (owner, 2026-10-03). The token checker's first
 * paid delivery (job 56882) ended every reason with "(block_token_safety)":
 * the model was shown tool results labelled with their function names and
 * cited them. Nobody reading a result knows or cares what a function is called.
 * The prompt now forbids it; this is the guarantee.
 *
 *   "Not a honeypot (block_token_safety)."   -> "Not a honeypot."
 *   "per `block_market_snapshot`, ..."        -> "per the market snapshot, ..."
 */
export function stripToolNames(text: string): string {
  const BLOCK = /`?\b(?:block|knowledge)_[a-z0-9_]+\b`?/gi;
  // A parenthetical that only names tools ("(block_x)", "(source: block_x, block_y)") goes entirely.
  let out = text.replace(/[^\S\n]*\(([^()\n]*)\)/g, (match, inner: string) => {
    if (!/\b(?:block|knowledge)_[a-z0-9_]+\b/i.test(inner)) return match;
    const rest = inner.replace(BLOCK, "").replace(/\b(source|sources|via|from|per|and|tool|tools)\b|[,:;/&+\s-]/gi, "");
    return rest.length === 0 ? "" : match.replace(BLOCK, "").replace(/\(\s*[,;:]?\s*/, "(").replace(/\s*[,;:]?\s*\)/, ")");
  });
  // Anything left is mid-sentence: say what it is in words.
  out = out.replace(BLOCK, (name) => `the ${name.replace(/`/g, "").replace(/^(?:block|knowledge)_/i, "").replace(/_/g, " ")}`);
  // Only where a citation came out: a space before punctuation, a doubled space between words.
  // Line-start indentation (nested lists) and trailing hard breaks are left alone.
  return out.replace(/(?<=\S)[^\S\n]+([.,;:])/g, "$1").replace(/(?<=\S)[^\S\n]{2,}(?=\S)/g, " ");
}
