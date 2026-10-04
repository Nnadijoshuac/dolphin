"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";

import { setupsApi } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * LIST AN AGENT'S SETUP (owner, 2026-10-04: "sell your whole setup... the strategy will be locked").
 * Says plainly what a buyer sees and what stays locked, before the seller signs anything.
 */
export function ListSetupDialog({ conversationKey, agentName, onClose }: { conversationKey: string; agentName: string | null; onClose: () => void }) {
  const session = useWalletSession();
  const publish = useMutation(setupsApi.setups.publish);
  const [title, setTitle] = useState(agentName ?? "");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [listed, setListed] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const sessionToken = session.sessionToken ?? (await session.signIn());
      if (!sessionToken) return;
      setListed(await publish({ sessionToken, conversationKey, title, summary }));
    } catch (cause) {
      toast.error(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not list the setup.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div aria-labelledby="list-setup-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="dialog">
      <div className="confirm-card">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Trading setups</p>
        <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-ink" id="list-setup-title">
          {listed ? "Listed" : "List this setup"}
        </h3>
        {listed ? (
          <>
            <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-soft">
              It is on Trading setups now. Dolphin is running its backtest; the numbers appear on its page in a moment.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" onClick={onClose} type="button">
                Close
              </button>
              <Link className="flex h-9 items-center rounded-lg bg-ink px-4 !text-[13px] font-semibold no-underline" href={`/setups/${listed}`}>
                <span className="text-canvas">See its page</span>
              </Link>
            </div>
          </>
        ) : (
          <>
            <label className="mt-3 block text-[0.72rem] font-semibold text-muted">
              Title
              <input
                className="mt-1 w-full rounded-lg border border-line bg-paper-strong px-2.5 py-1.5 text-[0.86rem] font-normal text-ink"
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <label className="mt-3 block text-[0.72rem] font-semibold text-muted">
              What it is for (buyers read this)
              <textarea
                className="mt-1 h-20 w-full resize-none rounded-lg border border-line bg-paper-strong px-2.5 py-1.5 text-[0.82rem] font-normal text-ink"
                maxLength={600}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="E.g. a calm 4-hour trend follower for BNB - few trades, tight stops."
                value={summary}
              />
            </label>
            <ul className="mt-3 space-y-1.5 text-[0.76rem] leading-relaxed text-ink-soft">
              <li>
                <strong>Buyers see</strong> each rule&rsquo;s coin, candles, size, stop, target and daily limit, a backtest Dolphin runs itself, and
                this agent&rsquo;s trades from now on.
              </li>
              <li>
                <strong>Locked:</strong> the entry and exit conditions. They stay on Dolphin&rsquo;s servers - buyers&rsquo; copies run them without
                ever showing them.
              </li>
              <li>
                <strong>Copied as written:</strong> this agent&rsquo;s name, description and instructions. Keep the strategy&rsquo;s details out of them.
              </li>
              <li>Buyers trade their own money from their own wallets. It is free to copy for now.</li>
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="h-9 rounded-lg bg-ink px-4 !text-[13px] font-semibold disabled:opacity-40" disabled={busy || title.trim().length < 3} onClick={() => void submit()} type="button">
                <span className="text-canvas">{busy ? "Listing…" : "List it"}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
