"use client";

import { useEffect, useRef, useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { WalletAvatar } from "@/components/wallet-avatar";
import { ALTANA_CHAIN_ID, ALTANA_NETWORK_LABEL } from "@/wallet/altana-policy";

/**
 * The "Receive" surface — the thing every wallet has and this one did not.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-12)
 * ---------------------------------------------------------------------------
 * "Receive" and "Deposit" on the wallet cards were wired to
 * `navigator.clipboard.writeText(address)` and nothing else. No confirmation,
 * no address shown, no error path — clicking either produced a completely
 * silent interface. If the clipboard write rejected (it does: an unfocused
 * document, a denied permission, Safari outside a user-gesture microtask)
 * the user got exactly the same nothing as on success.
 *
 * That is the single worst interaction on the page, because the failure is
 * invisible and the user's next move is to paste an address they do not have.
 *
 * The standard receive surface is: the address rendered in full, a copy
 * control that confirms, and the network stated. Pairing a visible address
 * with a copy button is the documented pattern rather than a preference —
 * some people scan or read, some paste, and offering only one path drops the
 * other. See Agent/SESSION-LOG-2026-09-12-wallet-ui.md for the sources.
 *
 * NO QR CODE YET, deliberately. A QR is the other half of this pattern and it
 * needs an encoder; this repo has none and AGENTS.md §1/§3 say to flag a gap
 * rather than add a dependency unilaterally. Hand-rolling Reed-Solomon here
 * was the alternative and it is the wrong trade: a silently mis-encoded QR
 * sends funds to an address that does not exist. An honest missing feature
 * beats a plausible-looking wrong one (§5, same reasoning as a fabricated
 * APY). The slot is marked in the markup below.
 * ---------------------------------------------------------------------------
 *
 * Native <dialog> rather than a hand-built overlay: Escape-to-close, focus
 * containment, inert background and the top layer all come for free and are
 * the parts hand-built modals get wrong.
 */

/** First 6 and last 4, emphasised — the segments a person is told to verify. */
function AddressSegments({ address }: { address: string }) {
  const head = address.slice(0, 6);
  const middle = address.slice(6, -4);
  const tail = address.slice(-4);
  return (
    <code className="receive-sheet__address">
      <span className="receive-sheet__address-edge">{head}</span>
      <span className="receive-sheet__address-mid">{middle}</span>
      <span className="receive-sheet__address-edge">{tail}</span>
    </code>
  );
}

export function ReceiveSheet({
  address,
  kind,
  label,
  note,
  onClose,
}: {
  address: string;
  kind: "human" | "bot";
  /** Which of the two accounts this is, in the user's words. */
  label: string;
  /** One line on what this account is for. */
  note: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  /*
   * Mount = open. There is no `open` prop, deliberately: the caller renders
   * this component only while a sheet is wanted, so the copy affordance resets
   * to "idle" through unmounting rather than through an effect that writes
   * state during render. A stale "Copied" carried over from a previous visit
   * would be a claim about THIS address that nothing had verified.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    /*
     * Focus AFTER showModal, not via the autoFocus prop.
     *
     * React applies autoFocus by calling .focus() during commit, which is
     * before this effect runs — and showModal() then executes the dialog
     * focusing steps itself, which land on the first focusable descendant.
     * That is the close button, so the sheet opened with a bright ring on
     * "dismiss this" and Enter threw away the sheet the user had just asked
     * for. Verified by screenshot: the prop alone did not survive showModal.
     */
    copyRef.current?.focus();
  }, []);

  return (
    <dialog
      aria-label={`Receive to ${label}`}
      className="receive-sheet"
      onCancel={onClose}
      onClick={(event) => {
        // Backdrop click: the <dialog> element itself is the backdrop's hit
        // target, so a click whose target IS the dialog came from outside the
        // panel inside it.
        if (event.target === ref.current) onClose();
      }}
      onClose={onClose}
      ref={ref}
    >
      <div className="receive-sheet__panel">
        <header className="receive-sheet__head">
          <WalletAvatar address={address} className="receive-sheet__avatar" kind={kind} size={40} />
          <div className="receive-sheet__head-text">
            <p className="receive-sheet__title">{label}</p>
            <p className="receive-sheet__note">{note}</p>
          </div>
          <button
            aria-label="Close"
            className="receive-sheet__close interactive"
            onClick={onClose}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="close" size={16} strokeWidth={2} />
          </button>
        </header>

        {/*
         * The QR slot. Not a placeholder graphic — a stated absence, because a
         * decorative square where a scannable code belongs is worse than the
         * sentence explaining why there isn't one.
         */}
        <p className="receive-sheet__qr-gap">
          No QR code yet. Dolphin will not draw a code it cannot guarantee
          scans back to this exact address.
        </p>

        <AddressSegments address={address} />

        <button
          className="wallet-action-btn wallet-action-btn--accent receive-sheet__copy interactive"
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
            size={14}
            strokeWidth={2}
          />
          {copied === "ok" ? "Copied to clipboard" : "Copy address"}
        </button>

        {/*
         * role="status" so the outcome is announced, not just drawn. The
         * failure branch says what to do instead rather than only that it
         * failed — the address is on screen above it and can be selected.
         */}
        <p className="receive-sheet__status" role="status">
          {copied === "failed"
            ? "Could not reach the clipboard. Select the address above and copy it manually."
            : copied === "ok"
              ? "Check the first six and last four characters against what you paste."
              : " "}
        </p>

        {/*
         * The network line is a warning, not a label. Sending a token from
         * another chain to this address is the most common way people lose
         * funds at this exact step, and the address alone does not say which
         * chain it is good for.
         */}
        <p className="receive-sheet__network">
          <CategoryGlyph color="currentColor" name="info" size={13} strokeWidth={2} />
          <span>
            {ALTANA_NETWORK_LABEL} (chain {ALTANA_CHAIN_ID}) only. Assets sent
            here on any other network cannot be recovered.
          </span>
        </p>

        <a
          className="receive-sheet__explorer interactive"
          href={`https://bscscan.com/address/${address}`}
          rel="noreferrer"
          target="_blank"
        >
          View on BscScan
          <CategoryGlyph color="currentColor" name="external" size={12} strokeWidth={2} />
        </a>
      </div>
    </dialog>
  );
}
