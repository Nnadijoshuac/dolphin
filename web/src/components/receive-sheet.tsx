"use client";

import { useEffect, useRef, useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { QrCode } from "@/components/qr-code";
import { ALTANA_CHAIN_ID, ALTANA_NETWORK_LABEL } from "@/wallet/altana-policy";

/**
 * The "Receive" surface — the thing every wallet has and this one did not.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS (2026-09-12)
 * ---------------------------------------------------------------------------
 * "Receive" and "Deposit" on the wallet cards were wired to
 * `navigator.clipboard.writeText(address)` and nothing else. No confirmation,
 * no address shown, no error path — clicking either produced a completely
 * silent interface, and a rejected clipboard write (unfocused document, denied
 * permission, Safari outside a user-gesture microtask) looked exactly like
 * success. The user's next move is pasting an address they do not have.
 *
 * ---------------------------------------------------------------------------
 * THIS IS ALSO THE ONLY PLACE A FULL ADDRESS APPEARS.
 * ---------------------------------------------------------------------------
 * It used to be three: a truncated one on each card, the full string in the
 * fund banner, and another full string in the recoverability panel's deposit
 * branch — each with its own copy button. An address repeated across a screen
 * is not reassurance, it is three things to check instead of one, and it is
 * how a person ends up comparing the wrong two.
 *
 * Everywhere else now shows a truncated address as a BUTTON that opens this
 * sheet. One surface owns the full string, the QR, the copy control and the
 * network warning.
 * ---------------------------------------------------------------------------
 *
 * Native <dialog>: Escape, focus containment, inert background and the top
 * layer come for free and are the parts hand-built modals get wrong.
 */

/** First six and last four carry the ink — the groups people are told to check. */
function AddressSegments({ address }: { address: string }) {
  return (
    <code className="receive-sheet__address">
      <span className="receive-sheet__address-edge">{address.slice(0, 6)}</span>
      <span className="receive-sheet__address-mid">{address.slice(6, -4)}</span>
      <span className="receive-sheet__address-edge">{address.slice(-4)}</span>
    </code>
  );
}

export function ReceiveSheet({
  address,
  label,
  onClose,
}: {
  address: string;
  /** Which of the two accounts this is, in the user's words. */
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  /*
   * Mount = open. There is no `open` prop, deliberately: the caller renders
   * this only while a sheet is wanted, so the copy affordance resets by
   * unmounting rather than through an effect that writes state during render
   * (which this repo's eslint config rejects outright). A stale "Copied"
   * carried over from a previous visit would be a claim about THIS address
   * that nothing had verified.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    /*
     * Focus AFTER showModal, not via the autoFocus prop. React applies
     * autoFocus during commit; showModal then runs the dialog focusing steps
     * itself and lands on the first focusable descendant — the close button.
     * The sheet opened with a bright ring on "dismiss this" and Enter threw
     * away the sheet the user had just asked for. Caught by screenshot; the
     * prop alone does not survive showModal.
     */
    copyRef.current?.focus();
  }, []);

  return (
    <dialog
      aria-label={`Receive to ${label}`}
      className="receive-sheet"
      onCancel={onClose}
      onClick={(event) => {
        // The <dialog> element itself is the backdrop's hit target, so a click
        // whose target IS the dialog came from outside the panel inside it.
        if (event.target === ref.current) onClose();
      }}
      onClose={onClose}
      ref={ref}
    >
      <div className="receive-sheet__panel">
        <header className="receive-sheet__head">
          <p className="receive-sheet__title">{label}</p>
          <button
            aria-label="Close"
            className="receive-sheet__close interactive"
            onClick={onClose}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="close" size={15} strokeWidth={2} />
          </button>
        </header>

        {/*
         * The QR sits in a raised plate rather than flat on the sheet — it is
         * the thing a camera is pointed at, so it gets the physical emphasis.
         * QrCode renders in currentColor and returns null if the payload will
         * not encode, in which case the address and copy button below are still
         * a complete receive path. A code that does not encode THIS address is
         * never drawn.
         */}
        <div className="receive-sheet__plate">
          <QrCode size={156} value={address} />
        </div>

        <AddressSegments address={address} />

        <button
          className="wallet-btn wallet-btn--accent receive-sheet__copy"
          onClick={() => {
            const clipboard = navigator.clipboard;
            if (!clipboard) {
              setCopied("failed");
              return;
            }
            void clipboard.writeText(address).then(
              () => setCopied("ok"),
              () => setCopied("failed"),
            );
          }}
          ref={copyRef}
          type="button"
        >
          <CategoryGlyph
            color="currentColor"
            name={copied === "ok" ? "check" : "copy"}
            size={15}
            strokeWidth={2}
          />
          {copied === "ok" ? "Copied" : "Copy address"}
        </button>

        {/*
         * role="status" so the outcome is announced, not only drawn. The
         * failure branch says what to do instead — the address is on screen
         * above it and is selectable.
         */}
        <p className="receive-sheet__status" role="status">
          {copied === "failed" ? "Clipboard blocked — select the address above." : " "}
        </p>

        {/*
         * The network line is a warning, not a label. Sending another chain's
         * assets to this address is how people lose funds at exactly this step,
         * and the address itself does not say which chain it is good for.
         */}
        <p className="receive-sheet__network">
          <CategoryGlyph color="currentColor" name="info" size={13} strokeWidth={2} />
          <span>{ALTANA_NETWORK_LABEL} only · chain {ALTANA_CHAIN_ID}</span>
        </p>
      </div>
    </dialog>
  );
}
