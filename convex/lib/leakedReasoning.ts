/**
 * Whether a model reply is the model REASONING ABOUT ITS INSTRUCTIONS rather
 * than answering the person.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-26)
 * ---------------------------------------------------------------------------
 * The starter "How does Dolphin decide an agent is live?" was answered, on the
 * dev deployment, with:
 *
 *   We need to follow the instruction: In the "Consult" phase, we either call
 *   tools or return empty. The user asks: "..." ... So we should not call
 *   tools. Therefore we return empty. Thus we output nothing (just end).
 *   Probably the system expects a blank response. We'll output nothing.
 *
 * That is the free model thinking out loud about CONSULT_PROMPT, shown to a
 * person as Dolphin's answer - and then cached by `reusableAnswer`, so the
 * next person asking the same thing got it too.
 *
 * The cause is fixed where it starts (convex/dolphin.ts no longer carries the
 * consult step's prose forward). This is the second layer: whatever path a
 * reply took, one that reads as meta-talk about prompts is never shown and
 * never cached. A stated failure tells the user something true; this does not.
 *
 * ---------------------------------------------------------------------------
 * HOW IT DECIDES
 * ---------------------------------------------------------------------------
 * Signals a real answer to a person has no reason to contain: quoting the
 * prompt's own rule text, talking about "the user" in the third person,
 * planning its own output ("we'll output", "return empty"). One signal alone
 * could be a coincidence in a long answer, so it takes TWO distinct signals,
 * or one of the unmistakable ones (the prompt's own words). The leak above
 * trips seven.
 */

/** Phrases lifted from Dolphin's own prompts. No answer to a person quotes these. */
const PROMPT_QUOTES: readonly RegExp[] = [
  /\bDO NOT CALL TOOLS\b/,
  /\bCALL TOOLS WHEN\b/,
  /["“]consult["”] phase/i,
  /\bconsult(?:ation)? phase\b/i,
  /\b(?:CRITICAL RULES|RESPONSE RULES|SYSTEM_PROMPT|CONSULT_PROMPT)\b/,
];

/** Shapes of a model planning its reply instead of writing it. */
const PLANNING_SIGNALS: readonly RegExp[] = [
  /\bwe (?:need|have|should|must) to (?:follow|output|return|respond|answer|call)\b/i,
  /\bwe(?:'ll| will| should) (?:output|return|respond with)\b/i,
  /\breturn empty\b/i,
  /\boutput nothing\b/i,
  /\bthe user (?:asks|asked|is asking|wants|says|said)\b/i,
  /\b(?:the|my|these) instructions? (?:says?|tells?|requires?|is to)\b/i,
  /\bthe system (?:expects|wants|prompt)\b/i,
  /\bfollow the instruction\b/i,
];

export function looksLikeLeakedReasoning(text: string): boolean {
  if (PROMPT_QUOTES.some((pattern) => pattern.test(text))) return true;

  let signals = 0;
  for (const pattern of PLANNING_SIGNALS) {
    if (pattern.test(text)) signals += 1;
    if (signals >= 2) return true;
  }
  return false;
}
