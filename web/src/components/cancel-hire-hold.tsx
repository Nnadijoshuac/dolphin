"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { HoldButton } from "@/components/hold-button";
import { agentHiresApi } from "@/convex/api";
import { track } from "@/lib/analytics";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * "Hold to cancel hire" - one implementation for the manage page and for the
 * job card when a seller declined (owner, 2026-10-02: a declined job must offer
 * the way out right where the person reads that it was declined).
 *
 * HOLD TO CANCEL (owner, 2026-09-29): a press-and-hold replaces a two-step
 * confirm. Letting go early changes nothing.
 */
export function CancelHireHold({
  agentKey,
  address,
  onCancelled,
}: {
  agentKey: string;
  address: string;
  onCancelled?: () => void;
}) {
  const session = useWalletSession();
  const cancelHire = useMutation(agentHiresApi.agentHires.cancelHire);
  const [state, setState] = useState<"idle" | "cancelling" | "done" | { error: string }>("idle");

  async function run() {
    setState("cancelling");
    try {
      // Signs in if needed rather than sending the person elsewhere to do it.
      let token = session.sessionToken;
      if (!token) {
        token = await session.signIn(address);
        if (!token) {
          setState("idle");
          return;
        }
      }
      await cancelHire({ agentKey, sessionToken: token });
      track("hire_cancelled", { agentKey });
      setState("done");
      onCancelled?.();
    } catch (cause) {
      setState({ error: toUserMessage(cause, "The hire could not be cancelled. Nothing has changed.") });
    }
  }

  if (state === "done") return <p className="text-[0.8rem] leading-5 text-muted">Hire cancelled.</p>;

  return (
    <div>
      <HoldButton
        backgroundColor="var(--paper)"
        className="manage-hold"
        disabled={state === "cancelling"}
        doneLabel="Cancelling..."
        fillColor="#c9362b"
        fillTextColor="#ffffff"
        holdTime={1600}
        onHold={() => void run()}
        radius={11}
        resetAfter={1800}
        size="md"
        textColor="var(--hold-danger)"
      >
        Hold to cancel hire
      </HoldButton>
      {typeof state === "object" ? (
        <p className="mt-2 text-[0.76rem] leading-5 text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
