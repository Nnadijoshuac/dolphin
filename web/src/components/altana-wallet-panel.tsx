"use client";

import { useState } from "react";
import { useBalance } from "wagmi";

import { AgentActivity } from "@/components/agent-activity";
import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ReceiveSheet } from "@/components/receive-sheet";
import { StatePanel } from "@/components/state-panel";
import { WalletAvatar } from "@/components/wallet-avatar";
import type { AgentSessionRow } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import {
  ALTANA_CHAIN_ID,
  ALTANA_FUNDING_HINT,
  ALTANA_NETWORK_LABEL,
  FEATURE_SESSION_EXECUTION,
  formatBnb,
  recoverabilityCopy,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { summariseTotal } from "@/wallet/wallet-total";

/* ═══════════════════════════════════════════════════════════════════════════
   THE WALLET SCREEN
   ═══════════════════════════════════════════════════════════════════════════

   REDESIGNED 2026-09-12. What was wrong and what the shape is now.

   The old screen opened on a warning banner, then put two equally-weighted
   2.6rem balances side by side, then a third band restating one of them.
   There was no page title, no total, no entry point for the eye, and the
   network — the one piece of information that decides whether an address is
   safe to send to — was 0.7rem grey text floating between sections.

   Every wallet people actually use (Rainbow, Zerion, Phantom, Rabby, Coinbase
   Wallet) has settled on the same anatomy, and it is not arbitrary:

     1. ONE total, large, at the top. The question "how much do I have" gets
        answered before any other pixel.
     2. The network, stated as a chip, not buried.
     3. Primary actions directly under the total — receive / explorer /
        refresh — as a fixed row that does not move between states.
     4. Accounts below the total, secondary to it.
     5. Activity below accounts.
     6. Security and destructive controls last, visually separated.

   This file now follows that order. Notably, THE PHONE ALREADY DID: see
   components/mobile-wallet.tsx, which has had a total, a glyph action row and
   account cards since it was written. Desktop was the screen that had drifted,
   so this is bringing the big screen up to the small one rather than inventing
   a vocabulary. Labels, the account names and the total's honesty rule are
   deliberately identical to the mobile ones.

   WHAT DID NOT CHANGE: every number on this screen is still read live or
   rendered as an explicit unavailable state (AGENTS.md §5). The redesign adds
   no figure that is not sourced, and the total below refuses to print at all
   rather than present a partial sum as complete.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─────────────── tiny helpers ─────────────── */

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className="wallet-copy-btn interactive"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); },
          () => setCopied(false),
        );
      }}
      type="button"
    >
      <CategoryGlyph color="currentColor" name={copied ? "check" : "copy"} size={11} strokeWidth={2} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const HIDDEN_FIGURE = "••••";

/* ─────────────── session row ─────────────── */

function SessionRow({
  session, onRevoke, isBusy,
}: {
  session: AgentSessionRow;
  onRevoke: () => void;
  isBusy: boolean;
  isLiveThisTab?: boolean;
}) {
  const now = useNow();
  const expiresAt = new Date(session.expiry * 1000);
  const daysLeft =
    now === 0
      ? null
      : Math.max(0, Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)));
  const isExpiringSoon = daysLeft !== null && daysLeft <= 3;

  return (
    <li className="wallet-session-row">
      <div className="wallet-session-row__header">
        <div className="wallet-session-row__meta">
          <span
            aria-label={isExpiringSoon ? "expiring soon" : "active"}
            className={`wallet-session-dot ${isExpiringSoon ? "wallet-session-dot--warn" : "wallet-session-dot--ok"}`}
          />
          <span className="wallet-session-row__name">{session.agentName}</span>
          <span className="wallet-session-row__id">#{session.agentKey}</span>
        </div>
        <button
          className="wallet-revoke-btn interactive"
          disabled={isBusy}
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      </div>

      <div className="wallet-session-row__chips">
        <div className="wallet-chip">
          <p className="wallet-chip__label">Cap</p>
          <p className="wallet-chip__value">
            {formatBnb(BigInt(session.spendCapWei))} BNB
            <span className="wallet-chip__sub"> / {session.spendPeriod}</span>
          </p>
        </div>
        <div className="wallet-chip">
          <p className="wallet-chip__label">Expires</p>
          <p className={`wallet-chip__value ${isExpiringSoon ? "wallet-chip__value--warn" : ""}`}>
            {daysLeft === null ? "Active" : `${daysLeft}d`}
          </p>
        </div>
        <div className="wallet-chip">
          <p className="wallet-chip__label">Contracts</p>
          <p className="wallet-chip__value">{session.allowlist.length}</p>
        </div>
      </div>

      {session.grantTransactionHash && (
        <a
          className="interactive wallet-session-row__tx"
          href={`https://bscscan.com/tx/${session.grantTransactionHash}`}
          rel="noreferrer"
          target="_blank"
        >
          View on BscScan ↗
        </a>
      )}
    </li>
  );
}

/* ─────────────── recoverability ─────────────── */

/**
 * MOVED 2026-09-12: this used to be the FIRST thing on the wallet page, above
 * the title it did not have, rendered unconditionally by wallet-client.tsx.
 *
 * Two problems with that. It opened the screen on an alarm — a red-bordered
 * "Not recoverable yet — read this before you clear this browser" is a
 * terrible first impression of a page whose actual job is showing a balance.
 * And it rendered even with no Dolphin Wallet at all, warning about the
 * recoverability of an account that did not exist.
 *
 * It now sits directly under the account cards and only when there is a wallet
 * for it to describe. Same copy, same live KeyStore read, same three branches —
 * the finding is unchanged, it is just no longer shouted before the greeting.
 */
export function RecoverabilityPanel() {
  const wallet = useAltanaWallet();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "registering" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const copy = recoverabilityCopy(wallet.recoverability);
  const fee = wallet.registrationFeeWei;
  const canAffordFee =
    fee !== null && wallet.balanceWei !== null && wallet.balanceWei > fee;

  const isRegistered = wallet.recoverability === "registered";
  const isUnregistered = wallet.recoverability === "unregistered";

  return (
    <div className={`wallet-recoverability ${isRegistered ? "wallet-recoverability--ok" : isUnregistered ? "wallet-recoverability--warn" : ""}`}>
      <div className="wallet-recoverability__row">
        <p className="wallet-recoverability__title">
          <span aria-hidden="true" className="wallet-recoverability__icon">
            <CategoryGlyph color="currentColor" name="shield" size={13} strokeWidth={2} />
          </span>
          {copy.title}
        </p>
        <button
          className="interactive wallet-recoverability__recheck"
          disabled={wallet.isCheckingRecoverability}
          onClick={() => wallet.refreshRecoverability()}
          type="button"
        >
          {wallet.isCheckingRecoverability ? "Checking…" : "Re-check"}
        </button>
      </div>
      <p className="wallet-recoverability__body">{copy.body}</p>

      {wallet.recoverabilityError && (
        <p className="wallet-inline-error">{wallet.recoverabilityError}</p>
      )}

      {/*
       * Three mutually exclusive branches, never a disabled button.
       *
       * This used to render "Make recoverable — 0.000723 BNB + gas" greyed out
       * above a line explaining the balance was too low. That is a dead end: the
       * only control offered is one the user cannot use, and the thing that
       * WOULD unblock them (depositing) is not offered at all. Every Dolphin
       * Wallet in existence is empty, so that dead end was the state every user
       * actually saw.
       *
       * Now the panel offers the action that is genuinely available at each
       * point: deposit when short, register when funded, and neither when the
       * fee could not be read — because an action Dolphin cannot price is one it
       * must not put a button behind (AGENTS.md §5).
       */}
      {isUnregistered && (
        <div className="mt-4">
          {fee === null ? (
            <p className="wallet-inline-error">
              The registration fee could not be read just now, so Dolphin will not
              offer an action it cannot price for you. Re-check to try again.
            </p>
          ) : !canAffordFee ? (
            <div className="wallet-fund-banner">
              <div className="wallet-fund-banner__row">
                <p className="wallet-fund-banner__title">
                  Deposit BNB to make this wallet recoverable
                </p>
                {wallet.address && (
                  <CopyButton label="Copy wallet address" value={wallet.address} />
                )}
              </div>
              <code className="wallet-fund-banner__address">{wallet.address}</code>
              <p className="wallet-fund-banner__hint">
                {/*
                 * The fee is stated exactly because it was read from the chain.
                 * Gas is named but NOT quantified — Dolphin has not measured it
                 * and will not print a plausible-looking guess beside a real
                 * figure. "plus relay gas" is the honest amount of precision.
                 */}
                Registration costs {formatBnb(fee)} BNB plus relay gas, paid by
                this wallet. It currently holds{" "}
                {wallet.balanceWei === null
                  ? "an amount Dolphin could not read"
                  : `${formatBnb(wallet.balanceWei)} BNB`}
                . Send BNB to the address above, then re-check.
              </p>
            </div>
          ) : (
            <button
              className="wallet-action-btn wallet-action-btn--accent interactive"
              disabled={state.kind === "registering" || wallet.isBusy}
              onClick={() => {
                setState({ kind: "registering" });
                void wallet.registerWallet().then(
                  () => setState({ kind: "idle" }),
                  (cause: unknown) =>
                    setState({
                      kind: "error",
                      message: toUserMessage(cause, "That action could not be completed. Try again."),
                    }),
                );
              }}
              type="button"
            >
              {state.kind === "registering"
                ? "Confirm with passkey…"
                : `Make recoverable — ${formatBnb(fee)} BNB + gas`}
            </button>
          )}

          {state.kind === "error" && (
            <p className="wallet-error-banner mt-3">{state.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── quick action button ─────────────── */

/*
 * ConnectFirstPanel and WalletSetup used to live here. Both are gone: their
 * jobs moved INTO the two cards, so the connect prompt and the create/recover
 * prompt now occupy the same grid slots as the wallets they stand in for,
 * instead of being full-width panels that changed the shape of the screen.
 */

/**
 * One quick action.
 *
 * `glyph` is a CategoryGlyph name, not a character. The three actions here used
 * to be the literal strings "↓", "↗" and "↻" while the rest of this codebase —
 * including the phone's version of this exact row — drew Hugeicons through
 * CategoryGlyph. Arrow glyphs render at a different weight and baseline in
 * every font on every platform, which is why they looked misaligned; the fix
 * is to use the icon set that is already here.
 */
function WalletAction({ glyph, label, href, onClick, disabled }: {
  glyph: "receive" | "external" | "refresh";
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const cls = "wallet-quick interactive";
  const inner = (
    <>
      <span aria-hidden="true" className="wallet-quick__icon">
        <CategoryGlyph color="currentColor" name={glyph} size={18} strokeWidth={1.8} />
      </span>
      <span className="wallet-quick__label">{label}</span>
    </>
  );
  if (href) {
    return <a className={cls} href={href} rel="noreferrer" target="_blank">{inner}</a>;
  }
  return (
    <button className={cls} disabled={disabled} onClick={onClick} type="button">
      {inner}
    </button>
  );
}

/* ═══════════════ the total ═══════════════ */

/**
 * The hero: total, network, actions. The screen's entry point.
 *
 * The action row is rendered in every state at the same size, so the page does
 * not reflow as balances land — one of the small things that separates a wallet
 * that feels solid from one that feels like it is still loading.
 */
function WalletHero({
  hidden,
  onToggleHidden,
  onReceive,
  receiveTarget,
}: {
  hidden: boolean;
  onToggleHidden: () => void;
  onReceive: () => void;
  receiveTarget: string | null;
}) {
  const identity = useWallet();
  const dolphin = useAltanaWallet();

  const identityAddress = identity.isConnected ? identity.address : null;

  /*
   * chainId is PINNED to BNB Smart Chain, and this is a correctness fix, not
   * tidying. This read used to inherit whatever chain the connector happened
   * to be on, while the row beneath it was hard-coded to say "BNB Smart
   * Chain" — so a visitor whose MetaMask sat on Ethereum saw their ETH
   * balance, rendered in full, labelled as BNB. A real number attached to the
   * wrong asset is the same class of defect as a fabricated one.
   *
   * Pinning also makes this share a react-query key with the identity card's
   * own read, so the two resolve from one request rather than two.
   */
  const identityBalance = useBalance({
    address: identityAddress as `0x${string}` | undefined,
    chainId: ALTANA_CHAIN_ID,
    query: { enabled: Boolean(identityAddress) },
  });

  const total = summariseTotal({
    identityAddress,
    identityWei: identityBalance.data?.value ?? null,
    identityLoading: identityBalance.isLoading,
    dolphinAddress: dolphin.status === "connected" ? dolphin.address : null,
    dolphinWei: dolphin.balanceWei,
    dolphinLoading: dolphin.status === "loading" || dolphin.isReadingBalance,
    dolphinErrored: Boolean(dolphin.balanceError),
  });

  /*
   * A non-"ready" hero renders WORDS, not a figure — and this took two goes.
   *
   * First attempt printed "0", which is a fabricated balance: with nothing
   * connected the hero said "0 BNB" directly above "No account connected yet",
   * and the louder of those two contradicting lines was the wrong one. Nobody
   * holds zero here; there is simply nothing to report (AGENTS.md §5).
   *
   * Second attempt printed "—", which typechecks as honest and looks like a
   * redaction: an em-dash set at 3.75rem is a 60-pixel horizontal bar, and on
   * screen it reads as a loading skeleton rather than as an absent value. That
   * is the kind of thing only a screenshot tells you.
   *
   * So the placeholder is a short phrase at a smaller size. It cannot be
   * mistaken for a number, it cannot be mistaken for a skeleton, and it says
   * which of the three non-answers this is.
   */
  const placeholder =
    total.kind === "reading"
      ? "Reading…"
      : total.kind === "partial"
        ? "Unavailable"
        : "No balance yet";

  const caption =
    total.kind === "ready"
      ? `Across ${total.accounts} ${total.accounts === 1 ? "account" : "accounts"} on ${ALTANA_NETWORK_LABEL}`
      : total.kind === "reading"
        ? `Checking every connected account on ${ALTANA_NETWORK_LABEL}.`
        : total.kind === "partial"
          ? "One balance could not be read, so this is not a total. The per-account figures below are what Dolphin does know."
          : "Connect an account below and its balance appears here.";

  function refreshAll() {
    void identityBalance.refetch();
    void dolphin.refreshBalance();
  }

  return (
    <section aria-labelledby="wallet-total-heading" className="wallet-hero">
      <div className="wallet-hero__head">
        <div>
          <p className="eyebrow">Wallet</p>
          <h1 className="wallet-hero__heading" id="wallet-total-heading">
            Total balance
          </h1>
        </div>

        {/*
         * The network, as a chip. It was 0.7rem grey text in a row between
         * sections. Which chain an address is good for is the single fact that
         * decides whether sending to it loses the funds, and it should not be
         * the smallest text on a wallet screen.
         */}
        <span className="wnet-chip">
          <span aria-hidden="true" className="wnet-chip__dot" />
          <BnbLogo size={14} />
          {ALTANA_NETWORK_LABEL}
          <span className="wnet-chip__id">chain {ALTANA_CHAIN_ID}</span>
        </span>
      </div>

      {total.kind === "ready" ? (
        <p className="wallet-hero__figure">
          {hidden ? HIDDEN_FIGURE : formatBnb(total.wei)}
          <span className="wallet-hero__unit">BNB</span>
          <button
            className="wallet-hero__eye interactive"
            onClick={onToggleHidden}
            type="button"
          >
            {hidden ? "Show" : "Hide"}
          </button>
        </p>
      ) : (
        /* No unit either — "Unavailable BNB" would be a denomination for a
           quantity that does not exist. */
        <p className="wallet-hero__placeholder">{placeholder}</p>
      )}

      {/*
       * aria-live so a total that arrives after the page does is announced.
       * "polite" because it is never urgent and a screen reader should not be
       * interrupted mid-sentence by a balance settling.
       */}
      <p aria-live="polite" className="wallet-hero__caption">
        {caption}
      </p>

      {/*
       * There is no USD figure here and there is not going to be one until a
       * price source is wired. Dolphin reads no oracle and calls no price API,
       * so any fiat number on this screen would be invented — and a made-up
       * dollar value next to a real BNB balance is precisely what AGENTS.md §5
       * rules out. The caption says "BNB" and means it.
       */}

      <div className="wallet-hero__actions">
        <WalletAction
          disabled={receiveTarget === null}
          glyph="receive"
          label="Receive"
          onClick={onReceive}
        />
        {receiveTarget ? (
          <WalletAction
            glyph="external"
            href={`https://bscscan.com/address/${receiveTarget}`}
            label="BscScan"
          />
        ) : (
          <WalletAction disabled glyph="external" label="BscScan" />
        )}
        <WalletAction
          disabled={total.kind === "reading"}
          glyph="refresh"
          label="Refresh"
          onClick={refreshAll}
        />
      </div>
    </section>
  );
}

/* ─────────────── identity wallet card (wagmi) ─────────────── */

function IdentityWalletCard({
  hidden,
  onReceive,
}: {
  hidden: boolean;
  onReceive: (address: string) => void;
}) {
  const identity = useWallet();
  const { data: balData, isLoading: balLoading } = useBalance({
    address: identity.address as `0x${string}` | undefined,
    // Same pin, same reason, and the same query key as the hero's read.
    chainId: ALTANA_CHAIN_ID,
    query: { enabled: Boolean(identity.isConnected && identity.address) },
  });

  /*
   * The empty state is a CARD, not an absence.
   *
   * It occupies the same grid slot at the same size as the connected card, so
   * the two-column shape of this screen never changes with connection state -
   * cards do not grow into the row or drop below one another as wallets come
   * and go. What changes is only what is inside the slot.
   */
  if (!identity.isConnected || !identity.address) {
    return (
      <div className="wcard wcard--identity wcard--empty" aria-label="Identity wallet">
        <div className="wcard__top-row">
          <div className="wcard__eyebrow">Your wallet</div>
        </div>
        <p className="wcard__empty-title">Not connected</p>
        <p className="wcard__empty-body">
          Connect an address so Dolphin can remember which agents you have
          hired. It reads the public address only.
        </p>
        <div className="wcard__empty-action">
          <WalletConnectButton connectLabel="Connect wallet" />
        </div>
      </div>
    );
  }

  /*
   * Formatted with the SAME helper the agent card uses, deliberately.
   *
   * This previously did its own `Number(value / 10n**14n) / 10000` then
   * `.toFixed(4)`, which truncated to 4 decimals while the agent card's
   * formatBnb keeps 6. Two cards on one screen, both denominated in BNB on the
   * same chain, disagreed about the same quantity: a balance that rendered as
   * "0.00001" on one showed as "0.0000" on the other, which reads as "empty"
   * when it is not. Sharing formatBnb makes that class of mismatch impossible
   * rather than merely fixed once.
   *
   * It also drops a float conversion from a wei value — formatBnb stays in
   * bigint arithmetic, so a large balance cannot lose precision.
   */
  const bnbStr = balLoading ? "…" : balData ? formatBnb(balData.value) : "—";
  const shown = hidden && balData ? HIDDEN_FIGURE : bnbStr;
  const address = identity.address;

  return (
    <div className="wcard wcard--identity" aria-label="Identity wallet">
      <div className="wcard__top-row">
        <div className="wcard__ident">
          <WalletAvatar address={address} className="wcard__avatar" kind="human" size={36} />
          <div className="wcard__ident-text">
            <p className="wcard__eyebrow">Your wallet</p>
            <button
              className="wcard__addr-btn interactive"
              onClick={() => onReceive(address)}
              title="Show full address"
              type="button"
            >
              <code>{truncateAddress(address)}</code>
              <CategoryGlyph color="currentColor" name="receive" size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      <p className="wcard__balance-line">
        <span className="wcard__balance-figure">{shown}</span>
        <span className="wcard__balance-unit">BNB</span>
      </p>
      <p className="wcard__hero-sub">Identity · signs in, holds your hire records</p>

      <div className="wcard__asset-list">
        <div className="wcard__asset-row">
          <span className="wcard__asset-icon"><BnbLogo size={18} /></span>
          <span className="wcard__asset-name">BNB</span>
          <span className="wcard__asset-sub">{ALTANA_NETWORK_LABEL}</span>
          <span className="wcard__asset-amount">{shown}</span>
        </div>
      </div>

      {/*
       * Disconnect lives HERE now, on the card for the account it disconnects.
       *
       * It used to be a separate full-width band under the cards
       * (IdentityWalletSection) whose entire content was a heading repeating
       * "Identity wallet", a sentence repeating what the card already said, and
       * this control. A third strip restating a card that is six inches above
       * it is the kind of thing that makes a page feel unconsidered.
       *
       * Still WalletConnectButton rather than a local button, for the reason
       * that component's own comment gives: it owns the two-step confirm, and a
       * second disconnect path here would be one click where the other is two.
       */}
      <div className="wcard__connect">
        <WalletConnectButton connectLabel="Connect wallet" />
      </div>
    </div>
  );
}

/* ─────────────── agent wallet card (Altana passkey) ─────────────── */

/**
 * The agent slot, in whichever of its three states applies.
 *
 * Like IdentityWalletCard it always renders a card of the same shape, so the
 * grid keeps its two columns whether a Dolphin Wallet exists, cannot exist in
 * this browser, or has simply not been created yet.
 */
function AgentWalletCard({
  hidden,
  onReceive,
}: {
  hidden: boolean;
  onReceive: (address: string) => void;
}) {
  const wallet = useAltanaWallet();

  // No wallet on this device: an invitation, not an empty box. Creation stays
  // an explicit user action - nothing here creates one as a side effect.
  if (wallet.status !== "connected" || !wallet.address) {
    const blocked = wallet.status === "unsupported";
    return (
      <div className="wcard wcard--agent wcard--empty" aria-label="Agent payments wallet">
        <div className="wcard__top-row">
          <div className="wcard__eyebrow">Agent payments</div>
        </div>
        <p className="wcard__empty-title">
          {blocked ? "Not available here" : "No wallet yet"}
        </p>
        <p className="wcard__empty-body">
          {blocked
            ? wallet.unsupportedReason ?? "This browser cannot hold a passkey wallet."
            : "A passkey-secured account that pays agents on your behalf. Optional — you only need it to pay an agent."}
        </p>
        {/*
         * Ghost, not accent — and that is the hierarchy, not a downgrade.
         *
         * Both empty cards sit side by side, and only one of them is the path a
         * new visitor needs: connecting an address is what makes hiring work.
         * This wallet is genuinely optional and says so. Two solid accent
         * buttons competing across the row would flatten that distinction into
         * "pick one", which is the opposite of true.
         */}
        {!blocked && (
          <div className="wcard__empty-action">
            <button
              className="wallet-action-btn wallet-action-btn--ghost interactive"
              disabled={wallet.isBusy}
              onClick={() => void wallet.createWallet()}
              type="button"
            >
              {wallet.isBusy ? "Waiting for passkey…" : "Create with passkey"}
            </button>
            <button
              className="wcard__empty-link interactive"
              disabled={wallet.isBusy}
              onClick={() => void wallet.recoverWallet()}
              type="button"
            >
              I already have one — recover it
            </button>
          </div>
        )}
        {wallet.error && <p className="wallet-inline-error">{wallet.error}</p>}
      </div>
    );
  }

  const address = wallet.address;
  const readable = !wallet.balanceError && wallet.balanceWei !== null;
  const figure = wallet.balanceError
    ? "Unavailable"
    : wallet.balanceWei === null
      ? (wallet.isReadingBalance ? "…" : "—")
      : hidden
        ? HIDDEN_FIGURE
        : formatBnb(wallet.balanceWei);

  return (
    <div className="wcard wcard--agent" aria-label="Agent payments wallet">
      <div className="wcard__top-row">
        {/*
         * "Agent Payments", not "For agents" / "Agent spending".
         *
         * The old wording was ambiguous in a money-shaped way: it read as
         * though this account holds what an agent EARNS. It does not, and
         * there is no code path that would put earnings here — a paid hire
         * sends $U to the agent's own registered ERC-8004 wallet
         * (convex/agentPayments.ts verifies the payee against it). This
         * balance is outbound only: funds the USER deposits in order to pay
         * agents. The subcopy below says so in as many words.
         */}
        <div className="wcard__ident">
          <WalletAvatar address={address} className="wcard__avatar" kind="bot" size={36} />
          <div className="wcard__ident-text">
            <p className="wcard__eyebrow">Agent payments</p>
            <button
              className="wcard__addr-btn interactive"
              onClick={() => onReceive(address)}
              title="Show full address"
              type="button"
            >
              <code>{truncateAddress(address)}</code>
              <CategoryGlyph color="currentColor" name="receive" size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
        <span className="wcard__badge">
          <CategoryGlyph color="currentColor" name="shield" size={11} strokeWidth={2} />
          Passkey
        </span>
      </div>

      <p className={`wcard__balance-line${readable ? "" : " wcard__balance-line--muted"}`}>
        <span className="wcard__balance-figure">{figure}</span>
        {readable && <span className="wcard__balance-unit">BNB</span>}
      </p>
      <p className="wcard__hero-sub">Funds you deposit to pay agents you hire</p>

      <div className="wcard__asset-list">
        <div className="wcard__asset-row">
          <span className="wcard__asset-icon"><BnbLogo size={18} /></span>
          <span className="wcard__asset-name">BNB</span>
          <span className="wcard__asset-sub">Dolphin Wallet · passkey-secured</span>
          <span className="wcard__asset-amount">{readable ? figure : "—"}</span>
        </div>
      </div>

      <div className="wcard__connect">
        <button
          className="wallet-action-btn wallet-action-btn--ghost interactive"
          onClick={() => onReceive(address)}
          type="button"
        >
          Deposit BNB
        </button>
      </div>
    </div>
  );
}

/* ─────────────── danger zone ─────────────── */

function DeviceAccessSection() {
  const wallet = useAltanaWallet();
  const [confirmForget, setConfirmForget] = useState(false);

  return (
    <section className="wallet-danger-zone" aria-label="Device access">
      <div className="wallet-danger-zone__body">
        <p className="wallet-danger-zone__title">Remove from this device</p>
        <p className="wallet-danger-zone__sub">
          Clears the local record only. Active permissions on-chain are unchanged.
        </p>
      </div>
      {confirmForget ? (
        <div className="wallet-danger-zone__confirm">
          <p className="wallet-danger-zone__confirm-label">Remove wallet from this browser?</p>
          <div className="wallet-danger-zone__confirm-actions">
            <button
              className="wallet-action-btn wallet-action-btn--ghost interactive"
              onClick={() => setConfirmForget(false)}
              type="button"
            >
              Keep it
            </button>
            <button
              className="wallet-action-btn wallet-action-btn--danger interactive"
              onClick={() => { wallet.forgetWallet(); setConfirmForget(false); }}
              type="button"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          className="interactive wallet-danger-zone__trigger"
          onClick={() => setConfirmForget(true)}
          type="button"
        >
          Remove
        </button>
      )}
    </section>
  );
}

/* ─────────────── permissions ─────────────── */

/*
 * Gated off by FEATURE_SESSION_EXECUTION (see altana-policy.ts for the full
 * reasoning). The flag removes this from the rendered tree entirely rather than
 * disabling controls inside it, while keeping the markup type-checked and one
 * flag away from returning.
 *
 * Why it is off: a granted session's signing key never reaches an agent and
 * nothing in this app can execute with one, so this panel listed permissions
 * that no party could exercise - and the Grant button that fed it charged real
 * BNB in gas to create them.
 */
function PermissionsSection() {
  const wallet = useAltanaWallet();
  const activeSessions = (wallet.sessions ?? []).filter((s) => s.status === "active");
  const pastSessions = (wallet.sessions ?? []).filter((s) => s.status !== "active");

  return (
    <section aria-labelledby="permissions-heading" className="wallet-section">
      <div className="wallet-section__header">
        <div>
          <p className="eyebrow">Agent access</p>
          <h2 className="wallet-section__title" id="permissions-heading">Permissions</h2>
        </div>
        {!wallet.sessionsUnavailable && wallet.sessions !== undefined && (
          <span className="wallet-count-badge">{activeSessions.length} active</span>
        )}
      </div>

      {wallet.sessionsUnavailable ? (
        <StatePanel
          body="Backend not configured — active sessions cannot be shown. New grants are refused."
          compact
          state="unavailable"
          title="Permission records unavailable"
        />
      ) : wallet.sessions === undefined ? (
        <StatePanel
          body="Reading permission records…"
          compact
          state="syncing"
          title="Checking permissions"
        />
      ) : activeSessions.length === 0 ? (
        <div className="wallet-empty-permissions">
          <span className="wallet-empty-permissions__icon">
            <CategoryGlyph color="currentColor" name="shield" size={16} strokeWidth={2} />
          </span>
          <div>
            <p className="wallet-empty-permissions__title">No active permissions</p>
            <p className="wallet-empty-permissions__sub">Read-only hires receive no spending authority.</p>
          </div>
        </div>
      ) : (
        <ul className="wallet-sessions-list">
          {activeSessions.map((session) => (
            <SessionRow
              isBusy={wallet.isBusy}
              isLiveThisTab={wallet.liveSessionKeys.includes(session.sessionPublicKey)}
              key={session.sessionPublicKey}
              onRevoke={() => void wallet.revokeSession(session.sessionPublicKey)}
              session={session}
            />
          ))}
        </ul>
      )}

      {pastSessions.length > 0 && (
        <details className="wallet-past-sessions">
          <summary>
            {pastSessions.length} inactive permission{pastSessions.length === 1 ? "" : "s"}
          </summary>
          <ul className="wallet-past-sessions__list">
            {pastSessions.map((session) => (
              <li className="wallet-past-sessions__row" key={session.sessionPublicKey}>
                <div>
                  <p className="wallet-past-sessions__name">{session.agentName}</p>
                  <p className="wallet-past-sessions__meta">
                    {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
                    {" · "}#{session.agentKey}
                  </p>
                </div>
                <span className="wallet-past-sessions__status">{session.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ─────────────── public export ─────────────── */

/**
 * Decides which wallet layout the screen shows.
 *
 * ---------------------------------------------------------------------------
 * FIXED (2026-09-01): the identity card no longer depends on the agent wallet.
 * ---------------------------------------------------------------------------
 * This used to branch on `wallet.status` ALONE, and that status describes only
 * the Altana/Dolphin wallet - altana-provider.tsx derives it as
 * `stored ? "connected" : "no-wallet"`, where `stored` is the passkey
 * credential in localStorage. IdentityWalletCard is rendered inside
 * ConnectedWallet, so it was reachable only once a Dolphin Wallet existed.
 *
 * The effect: someone could connect MetaMask and see no trace of it, because
 * the screen was still showing "create a Dolphin Wallet". Two independent
 * accounts, one of them gating the other's visibility for no reason.
 *
 * ---------------------------------------------------------------------------
 * SIMPLIFIED (2026-09-12): one layout, not two.
 * ---------------------------------------------------------------------------
 * There used to be two whole render paths here — a "ConnectedWallet" dashboard
 * and a shorter no-wallet variant — which is how the screen ended up with a
 * fund banner, a refresh row and a "remove from this device" control that were
 * each conditional in a slightly different way from the card they belonged to.
 *
 * Now there is ONE dashboard and each section decides for itself whether it has
 * anything to say. Sections that describe the Dolphin Wallet render only when
 * there is one; the cards and the total render always, each in its own state.
 * That is why nothing below moves when a wallet is created — the sections were
 * always going to be in that order.
 *
 * This changes VISIBILITY only. createPasskeyWallet is untouched and remains a
 * separate, explicit, user-initiated action - nothing here auto-creates a
 * wallet or makes one a precondition for anything else.
 */
export function AltanaWalletPanel() {
  const wallet = useAltanaWallet();
  const identity = useWallet();
  const [hidden, setHidden] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);

  if (wallet.status === "loading") {
    return (
      <div className="wallet-loading">
        <StatePanel body="Checking this browser for a Dolphin Wallet credential." state="syncing" title="Checking device" />
      </div>
    );
  }

  const dolphinAddress = wallet.status === "connected" ? wallet.address : null;
  const identityAddress = identity.isConnected ? identity.address : null;

  /*
   * Which account the hero's Receive opens. The Dolphin Wallet wins when it
   * exists, because that is the one this screen can ask you to fund — the
   * identity wallet is the user's own MetaMask and they already have a full
   * interface for it.
   */
  const heroReceiveTarget = dolphinAddress ?? identityAddress;
  const isReceivingDolphin =
    receiving !== null && receiving.toLowerCase() === dolphinAddress?.toLowerCase();

  return (
    <div className="wallet-dashboard">
      <WalletHero
        hidden={hidden}
        onReceive={() => setReceiving(heroReceiveTarget)}
        onToggleHidden={() => setHidden((value) => !value)}
        receiveTarget={heroReceiveTarget}
      />

      <section aria-label="Accounts" className="wallet-dual-section">
        <AgentWalletCard hidden={hidden} onReceive={setReceiving} />
        <IdentityWalletCard hidden={hidden} onReceive={setReceiving} />
      </section>

      {/*
       * Recoverability, directly under the card it describes, and only when
       * there is a wallet to describe. See RecoverabilityPanel's own note for
       * why it is no longer the first thing on the page.
       */}
      {dolphinAddress && <RecoverabilityPanel />}

      {/* Zero balance funding prompt — the one case where the deposit address
          is worth putting on the page rather than behind the Receive sheet. */}
      {dolphinAddress && wallet.balanceWei === BigInt(0) && (
        <div className="wallet-fund-banner">
          <div className="wallet-fund-banner__row">
            <p className="wallet-fund-banner__title">Fund the agent wallet to get started</p>
            <CopyButton label="Copy funding address" value={dolphinAddress} />
          </div>
          <code className="wallet-fund-banner__address">{dolphinAddress}</code>
          <p className="wallet-fund-banner__hint">{ALTANA_FUNDING_HINT}</p>
        </div>
      )}

      {wallet.error && <p className="wallet-error-banner">{wallet.error}</p>}

      <AgentActivity hidden={hidden} />

      {FEATURE_SESSION_EXECUTION && <PermissionsSection />}

      {dolphinAddress && <DeviceAccessSection />}

      {receiving && (
        <ReceiveSheet
          address={receiving}
          kind={isReceivingDolphin ? "bot" : "human"}
          label={isReceivingDolphin ? "Agent payments wallet" : "Your wallet"}
          note={
            isReceivingDolphin
              ? "Passkey-secured. Funds here pay the agents you hire."
              : "Your connected address. Dolphin only ever reads it."
          }
          onClose={() => setReceiving(null)}
        />
      )}
    </div>
  );
}
