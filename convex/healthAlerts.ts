import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { emailConfigured, sendEmail } from "./lib/email";
import { requireWalletAddress } from "./lib/walletAuth";
import { readHealthFactorStats } from "./protocols/venus";

/**
 * ===========================================================================
 * LIQUIDATION ALERTS
 * ===========================================================================
 * The first path by which this product can tell a person something. See the
 * note on the `healthAlerts` table in schema.ts for why it did not exist and
 * why its absence mattered more than any other gap.
 *
 * The shape is deliberately small. One address, one inbox, one threshold, one
 * email when the position first goes under. No digests, no channels, no
 * preferences screen - those are all things to add once anyone has actually
 * received one of these.
 */

/**
 * Venus liquidates at a health factor of 1.0.
 *
 * The floor here is above it on purpose: an alert that fires AT the
 * liquidation point has told you about something that has already happened. A
 * threshold is only useful if it leaves time to act, and the smallest useful
 * margin on a chain with ~0.45s blocks is still measured in the minutes it
 * takes a human to open a wallet and repay.
 */
export const MIN_THRESHOLD = 1.05;
export const MAX_THRESHOLD = 5;
export const DEFAULT_THRESHOLD = 1.5;

/**
 * Never more than one email per address per this window, whatever the position
 * does.
 *
 * `wasBelow` already suppresses the steady state - a position sitting under
 * the threshold does not re-fire. This is the backstop for a value that
 * FLAPS: a health factor oscillating either side of the line on successive
 * reads would otherwise be one email per crossing, which is the failure mode
 * that trains people to filter the sender.
 */
const MIN_NOTIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How many rows one cron tick will read. Each row is several RPC round trips. */
const BATCH_SIZE = 25;

/** Loose, deliberately. Real validation is the message arriving. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
}

function normalizeThreshold(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < MIN_THRESHOLD || value > MAX_THRESHOLD) return null;
  /* Two decimals. A threshold of 1.5000000001 is not a different intent. */
  return Math.round(value * 100) / 100;
}

/**
 * Unguessable, and not derived from the address or the email.
 *
 * A token derived from either would let anyone holding one unsubscribe the
 * other, and an address is public.
 */
function newUnsubscribeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

/**
 * Whether this deployment can send at all.
 *
 * The UI asks before offering a signup. A deployment with no RESEND_API_KEY
 * accepting a subscription would be promising delivery it cannot perform,
 * which is the same fault as a metric that says "syncing" forever.
 */
export const alertsAvailable = query({
  args: {},
  returns: v.boolean(),
  handler: async () => emailConfigured(),
});

export const getAlertForWallet = query({
  args: { sessionToken: v.string() },
  returns: v.union(
    v.object({
      email: v.string(),
      threshold: v.number(),
      active: v.boolean(),
      lastHealthFactor: v.union(v.number(), v.null()),
      lastCheckedAt: v.union(v.number(), v.null()),
      lastNotifiedAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { sessionToken }) => {
    let walletAddress: string;
    try {
      walletAddress = await requireWalletAddress(ctx, sessionToken, "getAlertForWallet");
    } catch {
      return null;
    }

    const row = await ctx.db
      .query("healthAlerts")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!row) return null;

    return {
      email: row.email,
      threshold: row.threshold,
      active: row.active,
      lastHealthFactor: row.lastHealthFactor,
      lastCheckedAt: row.lastCheckedAt,
      lastNotifiedAt: row.lastNotifiedAt,
    };
  },
});

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

/**
 * Subscribe the signed-in wallet to liquidation alerts.
 *
 * The address comes from the session, never from an argument - the same rule
 * every other mutation in this backend follows since 2026-09-06. An alert that
 * could be created against someone else's address would be a way to mail a
 * stranger about their own loan.
 */
export const subscribe = mutation({
  args: {
    sessionToken: v.string(),
    email: v.string(),
    threshold: v.number(),
  },
  returns: v.object({ ok: v.boolean(), reason: v.union(v.string(), v.null()) }),
  handler: async (ctx, { sessionToken, email, threshold }) => {
    if (!emailConfigured()) {
      return {
        ok: false,
        reason: "Alerts are not configured on this deployment, so nothing would be sent.",
      };
    }

    const walletAddress = await requireWalletAddress(ctx, sessionToken, "subscribe");

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return { ok: false, reason: "That does not look like an email address." };
    }

    const normalizedThreshold = normalizeThreshold(threshold);
    if (normalizedThreshold === null) {
      return {
        ok: false,
        reason: `Pick a health factor between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}. Venus liquidates at 1.0, so an alert at or below it arrives too late to act on.`,
      };
    }

    const existing = await ctx.db
      .query("healthAlerts")
      .withIndex("by_wallet_email", (q) =>
        q.eq("walletAddress", walletAddress).eq("email", normalizedEmail),
      )
      .unique();

    if (existing) {
      /*
       * Reactivating resets `wasBelow` to null. Otherwise someone who
       * unsubscribed while under water and came back later would get no email
       * on the next read, because the row still remembers being below.
       */
      await ctx.db.patch(existing._id, {
        threshold: normalizedThreshold,
        active: true,
        wasBelow: existing.active ? existing.wasBelow : null,
      });
      return { ok: true, reason: null };
    }

    await ctx.db.insert("healthAlerts", {
      walletAddress,
      email: normalizedEmail,
      threshold: normalizedThreshold,
      active: true,
      wasBelow: null,
      lastHealthFactor: null,
      lastCheckedAt: null,
      lastNotifiedAt: null,
      unsubscribeToken: newUnsubscribeToken(),
      createdAt: Date.now(),
    });

    return { ok: true, reason: null };
  },
});

export const unsubscribe = mutation({
  args: { sessionToken: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { sessionToken }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "unsubscribe");

    const rows = await ctx.db
      .query("healthAlerts")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .collect();

    for (const row of rows) {
      if (row.active) await ctx.db.patch(row._id, { active: false });
    }

    return { ok: rows.length > 0 };
  },
});

/**
 * Stop the mail from the mail itself, with no sign-in.
 *
 * Someone who has lost the wallet, changed devices, or simply does not want to
 * connect anything must still be able to make an unwanted email stop. Holding
 * the token is the authorisation; it is unguessable and scoped to one row.
 */
export const unsubscribeByToken = mutation({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("healthAlerts")
      .withIndex("by_token", (q) => q.eq("unsubscribeToken", token))
      .unique();

    if (!row) return { ok: false };
    if (row.active) await ctx.db.patch(row._id, { active: false });
    return { ok: true };
  },
});

/* ---------------------------------------------------------------------------
 * The cron
 * ------------------------------------------------------------------------ */

export const dueAlerts = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"healthAlerts">[]> =>
    ctx.db
      .query("healthAlerts")
      .withIndex("by_active_checked", (q) => q.eq("active", true))
      .order("asc")
      .take(BATCH_SIZE),
});

export const recordCheck = internalMutation({
  args: {
    id: v.id("healthAlerts"),
    healthFactor: v.union(v.number(), v.null()),
    wasBelow: v.union(v.boolean(), v.null()),
    notified: v.boolean(),
  },
  handler: async (ctx, { id, healthFactor, wasBelow, notified }) => {
    const now = Date.now();
    await ctx.db.patch(id, {
      lastHealthFactor: healthFactor,
      wasBelow,
      lastCheckedAt: now,
      ...(notified ? { lastNotifiedAt: now } : {}),
    });
  },
});

function alertBody(input: {
  healthFactor: number;
  threshold: number;
  walletAddress: string;
  unsubscribeToken: string;
  siteUrl: string;
}): string {
  const { healthFactor, threshold, walletAddress, unsubscribeToken, siteUrl } = input;

  /*
   * Plain text, not HTML, and that is a deliberate product decision rather
   * than a shortcut. This message exists to be read in three seconds on a lock
   * screen by someone who may need to act. A styled template costs render time
   * in some clients, is what phishing imitating a wallet alert looks like, and
   * adds nothing a person in that moment wants.
   *
   * Note what it does NOT say: it does not tell anyone what to do. Dolphin
   * read a number and is repeating it with its source. Recommending a repay or
   * a top-up would be advice about someone's money that nothing here is in a
   * position to give.
   */
  return [
    `Your Venus health factor is ${healthFactor.toFixed(3)}.`,
    "",
    `That is below the ${threshold} you asked to be told about. Venus liquidates a position at 1.0.`,
    "",
    `Address: ${walletAddress}`,
    `Read from: the Venus Comptroller on BNB Smart Chain, just now.`,
    "",
    "Dolphin is telling you the number, not what to do about it. Check the position yourself before acting:",
    `${siteUrl}/wallet`,
    "",
    "---",
    "You asked Dolphin to watch this address. To stop these emails:",
    `${siteUrl}/wallet?unsubscribe=${unsubscribeToken}`,
  ].join("\n");
}

/**
 * One tick: read each due position, email the ones that have just gone under.
 *
 * Failures are per-row. A wallet whose RPC read throws does not stop the rest
 * of the batch, and a row whose email bounces is recorded as checked but not
 * as notified, so the next crossing still tries.
 */
export const runChecks = internalAction({
  args: {},
  returns: v.object({
    checked: v.number(),
    notified: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx) => {
    if (!emailConfigured()) {
      /*
       * Not an error and not silent. A deployment with no key should not be
       * burning RPC reads on positions it cannot report on.
       */
      console.warn("[healthAlerts] RESEND_API_KEY is not set; skipping.");
      return { checked: 0, notified: 0, failed: 0 };
    }

    const siteUrl = (process.env.SITE_URL ?? "").trim() || "https://dolphinamp.vercel.app";
    const rows = await ctx.runQuery(internal.healthAlerts.dueAlerts, {});

    let checked = 0;
    let notified = 0;
    let failed = 0;

    for (const row of rows) {
      checked += 1;

      const address = isAddress(row.walletAddress)
        ? getAddress(row.walletAddress)
        : null;

      if (!address) {
        failed += 1;
        await ctx.runMutation(internal.healthAlerts.recordCheck, {
          id: row._id,
          healthFactor: row.lastHealthFactor,
          wasBelow: row.wasBelow,
          notified: false,
        });
        continue;
      }

      const stats = await readHealthFactorStats(address, new Date().toISOString());
      const metric = stats.averageHealthFactor;

      /*
       * An UNREADABLE position is not a safe one, and it is not an unsafe one
       * either - it is unknown. `wasBelow` is left exactly as it was so that a
       * transient RPC failure between two below-threshold reads does not count
       * as a crossing when the next read succeeds.
       */
      if (metric.status !== "live" || typeof metric.value !== "number") {
        failed += 1;
        await ctx.runMutation(internal.healthAlerts.recordCheck, {
          id: row._id,
          healthFactor: null,
          wasBelow: row.wasBelow,
          notified: false,
        });
        continue;
      }

      const healthFactor = metric.value;
      const isBelow = healthFactor < row.threshold;

      /*
       * Fire only on the EDGE: previously known to be above (or previously
       * unknown and now below is NOT enough - see below), now below.
       *
       * `wasBelow === null` is the first successful read for this row. It does
       * not notify, because a subscription made while already under water
       * would otherwise email on the very next tick, before the person has
       * finished reading the confirmation screen. They already know; they just
       * told us the number to watch. The next genuine crossing will fire.
       */
      const crossed = row.wasBelow === false && isBelow;
      const throttled =
        row.lastNotifiedAt !== null &&
        Date.now() - row.lastNotifiedAt < MIN_NOTIFY_INTERVAL_MS;

      let didNotify = false;

      if (crossed && !throttled) {
        const result = await sendEmail({
          to: row.email,
          subject: `Venus health factor ${healthFactor.toFixed(2)} — below your ${row.threshold} alert`,
          text: alertBody({
            healthFactor,
            threshold: row.threshold,
            walletAddress: address,
            unsubscribeToken: row.unsubscribeToken,
            siteUrl,
          }),
        });

        if (result.ok) {
          didNotify = true;
          notified += 1;
        } else {
          failed += 1;
          console.error(`[healthAlerts] send failed: ${result.reason}`);
        }
      }

      await ctx.runMutation(internal.healthAlerts.recordCheck, {
        id: row._id,
        healthFactor,
        wasBelow: isBelow,
        notified: didNotify,
      });
    }

    return { checked, notified, failed };
  },
});
