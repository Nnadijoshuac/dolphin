/**
 * OUTBOUND EMAIL, VIA RESEND.
 *
 * ===========================================================================
 * WHY THE REST API AND NOT THE `resend` SDK (2026-09-12)
 * ===========================================================================
 * The provider decision was Resend. The transport decision is a plain `fetch`
 * against its REST endpoint rather than the npm package, and the reason is
 * verifiability rather than dependency-count purism:
 *
 *  - Convex functions run in a V8 runtime, not Node. A package that works in
 *    Node may or may not work here without a `"use node"` boundary, and this
 *    session cannot deploy to Convex to find out. One POST to a documented
 *    endpoint is something whose behaviour can be reasoned about completely
 *    from the code.
 *  - AGENTS.md §3 says never silently take on a dependency whose behaviour in
 *    this stack is unverified, and §1 says flag rather than add unilaterally.
 *
 * If the SDK is preferred later, only `sendEmail` changes. Everything above it
 * - the alert rules, the crossing logic, the copy - is transport-agnostic.
 *
 * ===========================================================================
 * IT NEVER THROWS
 * ===========================================================================
 * This is called from a cron. An exception thrown here would abort the batch
 * and every remaining subscriber would go unchecked because one inbox bounced.
 * Failures come back as a value, and the caller records that the send failed
 * without marking the alert as delivered.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Who the mail is from.
 *
 * Must be a domain verified in the Resend dashboard - Resend rejects anything
 * else outright, which is the correct behaviour and the most likely reason a
 * first send fails. Overridable so a staging deployment can send from its own
 * verified sender rather than production's.
 */
const DEFAULT_FROM = "Dolphin <alerts@dolphinamp.com>";

export type EmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: string; configured: boolean };

/**
 * True when this deployment can actually send.
 *
 * Exposed so the UI can say "alerts are not configured on this deployment"
 * instead of accepting a subscription that will silently never deliver. An
 * unconfigured deployment offering an alert signup is the "syncing" problem
 * again: a promise with nothing behind it.
 */
export function emailConfigured(): boolean {
  return (process.env.RESEND_API_KEY ?? "").trim().length > 0;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  /** Plain text. Deliberately not HTML - see the note in healthAlerts.ts. */
  text: string;
}): Promise<EmailResult> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (key.length === 0) {
    return {
      ok: false,
      configured: false,
      reason: "RESEND_API_KEY is not set on this Convex deployment.",
    };
  }

  const from = (process.env.ALERT_FROM_EMAIL ?? "").trim() || DEFAULT_FROM;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });

    if (!response.ok) {
      /*
       * Resend puts a readable reason in the body. Truncated because it ends
       * up in a log line, and an unbounded upstream string in a log is how a
       * deployment's storage bill becomes a surprise.
       */
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        configured: true,
        reason: `Resend refused the send (${response.status}): ${detail.slice(0, 300)}`,
      };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: body?.id ?? null };
  } catch (cause) {
    return {
      ok: false,
      configured: true,
      reason: `Could not reach Resend: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
