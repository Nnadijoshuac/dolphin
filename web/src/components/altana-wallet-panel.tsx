"use client";

import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { StatusBadge } from "@/components/status-badge";
import { useNow } from "@/hooks/use-now";
import {
  ALTANA_FUNDING_HINT,
  formatBnb,
} from "@/wallet/altana-policy";
import { useAltanaWallet, type StoredSession } from "@/wallet/altana-provider";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      aria-label={label}
      className="pressable-scale inline-flex items-center gap-1.5 rounded-xl border border-[#ECE8DE] bg-[#FBF9F4] px-2.5 py-1.5 text-[11px] font-bold text-[#6E706B] hover:border-[#F3E3A6] hover:bg-[#FEF5D6] hover:text-[#946B00]"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          },
          () => setCopied(false),
        );
      }}
      type="button"
    >
      <CategoryGlyph color="currentColor" name={copied ? "check" : "copy"} size={12} strokeWidth={2.5} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The one piece of copy on this screen that must not be softened: an Altana
 * wallet is a separate wallet with its own balance. Altana's SDK has no
 * injected signer (verified this session), so this can never be the user's
 * MetaMask account, and letting the two blur would be a money-shaped
 * misunderstanding rather than a cosmetic one.
 */
function SeparateWalletNotice() {
  return (
    <div className="rounded-2xl border border-[#F3E3A6] bg-[#FEF5D6] p-4">
      <div className="flex items-center gap-2">
        <CategoryGlyph color="#946B00" name="info" size={15} strokeWidth={2.5} />
        <p className="text-xs font-black text-[#946B00]">
          This is a separate wallet
        </p>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E706B]">
        A Dolphin Wallet is its own account with its own balance. It is{" "}
        <strong className="font-bold text-[#111214]">not</strong> your MetaMask
        or browser-extension wallet, and it does not hold or see those funds.
        Anything you want it to spend has to be sent to it.
      </p>
    </div>
  );
}

function SessionCard({
  session,
  onRevoke,
  isBusy,
  isLiveThisTab,
}: {
  session: StoredSession;
  onRevoke: () => void;
  isBusy: boolean;
  isLiveThisTab: boolean;
}) {
  // From the shared ticker, not Date.now(): reading the clock during render is
  // impure and the countdown should tick on its own anyway. `now` is 0 during
  // SSR, where a day count is simply not knowable yet.
  const now = useNow();
  const expiresAt = new Date(session.expiry * 1000);
  const daysLeft =
    now === 0
      ? null
      : Math.max(0, Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)));

  return (
    <li className="rounded-2xl border border-[#ECE8DE] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-[#111214]">
            {session.agentName}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#A5A79F]">
            Agent #{session.tokenId} · {session.category}
          </p>
        </div>
        <StatusBadge
          label={daysLeft === null ? "Active" : `${daysLeft}d left`}
          tone={daysLeft !== null && daysLeft <= 3 ? "stale" : "live"}
        />
      </div>

      <dl className="mt-3 space-y-2 border-t border-[#F3F0E8] pt-3 text-[11px]">
        <div className="flex items-start justify-between gap-3">
          <dt className="font-semibold text-[#6E706B]">Can spend up to</dt>
          <dd className="text-right font-black text-[#111214]">
            {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 font-semibold text-[#6E706B]">Can only call</dt>
          <dd className="text-right">
            {session.allowlist.map((contract) => (
              <div key={contract.address} className="mb-1 last:mb-0">
                <span className="block font-bold text-[#111214]">{contract.label}</span>
                <span className="block break-all font-mono text-[10px] text-[#A5A79F]">
                  {contract.address}
                </span>
              </div>
            ))}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="font-semibold text-[#6E706B]">Expires</dt>
          <dd className="text-right font-bold text-[#303236]">
            {expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </dd>
        </div>
        {session.transactionHash && (
          <div className="flex items-start justify-between gap-3">
            <dt className="font-semibold text-[#6E706B]">Grant transaction</dt>
            <dd className="break-all text-right font-mono text-[10px] text-[#A5A79F]">
              {session.transactionHash}
            </dd>
          </div>
        )}
      </dl>

      {!isLiveThisTab && (
        <p className="mt-3 rounded-xl bg-[#F5F3EB] p-2.5 text-[10px] leading-relaxed text-[#6E706B]">
          This session&apos;s signing key is not held in this browser tab, so it
          cannot execute from here. It is still active on-chain and still
          revocable below — Dolphin deliberately does not store a spend-capable
          key in your browser.
        </p>
      )}

      <button
        className="pressable-scale mt-3 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] px-4 text-xs font-black text-[#6E706B] hover:border-[#FECACA] hover:bg-[#FEE2E2] hover:text-[#B91C1C] disabled:opacity-50"
        disabled={isBusy}
        onClick={onRevoke}
        type="button"
      >
        <CategoryGlyph color="currentColor" name="revoke" size={14} strokeWidth={2.5} />
        Revoke this permission
      </button>
    </li>
  );
}

export function AltanaWalletPanel() {
  const wallet = useAltanaWallet();
  const [confirmForget, setConfirmForget] = useState(false);

  if (wallet.status === "loading") {
    return (
      <section className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-[#A5A79F]">Checking this device…</p>
      </section>
    );
  }

  if (wallet.status === "unsupported") {
    return (
      <section className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black tracking-tight text-[#111214]">
          Dolphin Wallet
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#6E706B]">
          {wallet.unsupportedReason}
        </p>
      </section>
    );
  }

  if (wallet.status === "no-wallet") {
    return (
      <section className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-[#946B00]">
              Dolphin native
            </span>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#111214]">
              Create a Dolphin Wallet
            </h2>
          </div>
          <StatusBadge label="Not created" tone="neutral" />
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[#6E706B]">
          A smart account secured by a passkey — your device&apos;s Face ID,
          Touch ID or Windows Hello. There is no seed phrase to write down and
          Dolphin never sees or stores a key. It is what lets you give an agent
          a bounded, revocable spending permission instead of unrestricted
          access.
        </p>

        <div className="mt-5">
          <SeparateWalletNotice />
        </div>

        <div className="mt-5 space-y-3">
          <button
            className="pressable-scale flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-5 text-sm font-black text-[#111214] shadow-sm hover:bg-[#E2A500] disabled:cursor-wait disabled:opacity-60"
            disabled={wallet.isBusy}
            onClick={() => void wallet.createWallet()}
            type="button"
          >
            <CategoryGlyph color="#111214" name="wallet" size={16} strokeWidth={2.4} />
            {wallet.isBusy ? "Waiting for your passkey…" : "Create with a passkey"}
          </button>

          <button
            className="pressable-scale flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] px-5 text-xs font-bold text-[#6E706B] hover:border-[#F3E3A6] hover:bg-[#FEF5D6] hover:text-[#946B00] disabled:opacity-50"
            disabled={wallet.isBusy}
            onClick={() => void wallet.recoverWallet()}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="shield" size={14} strokeWidth={2.5} />
            I already have one — recover it
          </button>
          <p className="text-center text-[11px] leading-relaxed text-[#A5A79F]">
            Recovering asks your device which Dolphin passkeys it holds and
            rebuilds the wallet from the one you pick. Use it on a new browser
            or after clearing site data.
          </p>
          {/* Verified live this session, and it surprises people: recovery
              reads the wallet's admin key out of Altana's on-chain KeyStore,
              and a key only lands there on the wallet's FIRST transaction. So
              a wallet that was created and never used cannot be recovered —
              it can only be created again. Saying so here is cheaper than
              letting someone meet that as a raw error. */}
          <p className="rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-3 text-center text-[11px] leading-relaxed text-[#6E706B]">
            <strong className="font-bold text-[#111214]">
              Recovery needs one prior transaction.
            </strong>{" "}
            A wallet&apos;s key is written to Altana&apos;s on-chain registry the
            first time the wallet does something. A wallet that was created and
            never used has nothing on-chain to recover from — create a new one
            instead.
          </p>
        </div>

        {wallet.error && (
          <p className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEE2E2] p-3 text-xs font-semibold leading-relaxed text-[#B91C1C]">
            {wallet.error}
          </p>
        )}
      </section>
    );
  }

  // status === "connected"
  const address = wallet.address!;

  return (
    <section className="space-y-4">
      {/* --- Account + assets ------------------------------------------- */}
      <div className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-[#946B00]">
              Dolphin native
            </span>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#111214]">
              Dolphin Wallet
            </h2>
          </div>
          <StatusBadge
            label={`${wallet.networkLabel} · ${wallet.chainId}`}
            tone="live"
          />
        </div>

        <div className="mt-5 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#A5A79F]">
              Wallet address
            </span>
            <CopyButton label="Copy wallet address" value={address} />
          </div>
          <p className="mt-1.5 break-all font-mono text-sm font-bold text-[#111214]">
            {address}
          </p>
        </div>

        {/* Asset list. Native BNB is the whole list on purpose: every Dolphin
            hire is free (0 BNB) and a session's spend cap is denominated in
            native BNB, so there is no other token this app's flows touch. A
            padded-out token list would be decoration, not information. */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-[#111214]">Assets</h3>
            <button
              className="pressable-scale rounded-xl border border-[#ECE8DE] bg-[#FBF9F4] px-2.5 py-1.5 text-[11px] font-bold text-[#6E706B] hover:border-[#F3E3A6] hover:bg-[#FEF5D6] hover:text-[#946B00] disabled:opacity-50"
              disabled={wallet.isReadingBalance}
              onClick={() => void wallet.refreshBalance()}
              type="button"
            >
              {wallet.isReadingBalance ? "Reading…" : "Refresh"}
            </button>
          </div>

          <div className="mt-2.5 overflow-hidden rounded-2xl border border-[#ECE8DE]">
            <div className="flex items-center justify-between gap-3 bg-white px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FEF5D6] text-sm font-black text-[#946B00]">
                  B
                </div>
                <div>
                  <p className="text-sm font-black text-[#111214]">BNB</p>
                  <p className="text-[11px] font-semibold text-[#A5A79F]">
                    {wallet.networkLabel} · native
                  </p>
                </div>
              </div>
              <div className="text-right">
                {wallet.balanceError ? (
                  <>
                    <p className="text-sm font-black text-[#B9473A]">Unavailable</p>
                    <p className="text-[10px] font-semibold text-[#A5A79F]">
                      Balance could not be read
                    </p>
                  </>
                ) : wallet.balanceWei === null ? (
                  <p className="text-sm font-black text-[#A5A79F]">
                    {wallet.isReadingBalance ? "Reading…" : "Not read yet"}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-black text-[#111214]">
                      {formatBnb(wallet.balanceWei)}
                    </p>
                    <p className="text-[10px] font-semibold text-[#A5A79F]">
                      Read live from chain {wallet.chainId}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {wallet.balanceError && (
            <p className="mt-2 break-words text-[10px] leading-relaxed text-[#A5A79F]">
              {wallet.balanceError}
            </p>
          )}
        </div>

        {/* Funding path — the wallet is counterfactual and empty until funded,
            so a zero balance without a next step is a dead end. */}
        {wallet.balanceWei !== null && wallet.balanceWei === BigInt(0) && (
          <div className="mt-5 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4">
            <div className="flex items-center gap-2">
              <CategoryGlyph color="#946B00" name="sparkle" size={15} strokeWidth={2.5} />
              <p className="text-xs font-black text-[#111214]">Fund this wallet</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E706B]">
              {ALTANA_FUNDING_HINT}
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-[#ECE8DE] bg-white px-3 py-2">
              <span className="break-all font-mono text-[11px] font-bold text-[#111214]">
                {address}
              </span>
              <CopyButton label="Copy funding address" value={address} />
            </div>
          </div>
        )}

        <div className="mt-5">
          <SeparateWalletNotice />
        </div>

        {wallet.error && (
          <p className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEE2E2] p-3 text-xs font-semibold leading-relaxed text-[#B91C1C]">
            {wallet.error}
          </p>
        )}
      </div>

      {/* --- Granted permissions ---------------------------------------- */}
      <div className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black tracking-tight text-[#111214]">
              What you&apos;ve authorized
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[#6E706B]">
              Every permission you have handed to an agent, with exactly what it
              can spend and which contracts it can touch.
            </p>
          </div>
          <StatusBadge
            label={`${wallet.sessions.length} active`}
            tone={wallet.sessions.length > 0 ? "live" : "neutral"}
          />
        </div>

        {wallet.sessions.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[#ECE8DE] bg-[#FBF9F4] p-5 text-center">
            <CategoryGlyph color="#A5A79F" name="shield" size={20} strokeWidth={2.2} />
            <p className="mt-2 text-sm font-black text-[#111214]">
              No agent can spend from this wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#6E706B]">
              You have granted no permissions. Agents you hire for information
              only never appear here — they are never given spending authority
              in the first place.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {wallet.sessions.map((session) => (
              <SessionCard
                isBusy={wallet.isBusy}
                isLiveThisTab={wallet.liveSessionKeys.includes(session.publicKey)}
                key={session.publicKey}
                onRevoke={() => void wallet.revokeSession(session.publicKey)}
                session={session}
              />
            ))}
          </ul>
        )}
      </div>

      {/* --- Remove from this browser ----------------------------------- */}
      <div className="rounded-3xl border border-[#ECE8DE] bg-white p-5 shadow-sm">
        {confirmForget ? (
          <div>
            <p className="text-xs font-bold text-[#111214]">
              Remove this wallet from this browser?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#6E706B]">
              Nothing on-chain changes and your passkey stays on your device —
              &ldquo;recover it&rdquo; brings the same wallet straight back. Any
              permissions you granted stay active until you revoke them.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                className="pressable-scale min-h-[40px] flex-1 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] px-4 text-xs font-bold text-[#6E706B]"
                onClick={() => setConfirmForget(false)}
                type="button"
              >
                Keep it
              </button>
              <button
                className="pressable-scale min-h-[40px] flex-1 rounded-2xl bg-[#FEE2E2] px-4 text-xs font-black text-[#B91C1C]"
                onClick={() => {
                  wallet.forgetWallet();
                  setConfirmForget(false);
                }}
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            className="pressable-scale w-full text-center text-xs font-bold text-[#A5A79F] hover:text-[#B91C1C]"
            onClick={() => setConfirmForget(true)}
            type="button"
          >
            Remove this wallet from this browser
          </button>
        )}
      </div>
    </section>
  );
}
