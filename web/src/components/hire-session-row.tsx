"use client";

import { useQuery as useConvexQuery } from "convex/react";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { agentSessionsApi } from "@/convex/api";
import { formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";

/**
 * The spending permission attached to one hire, shown next to that hire.
 *
 * Task 5 requires revocation to be reachable from the hire record's own screen
 * as well as the wallet screen. Both read the same Convex rows, so they cannot
 * drift apart - see convex/agentSessions.ts.
 *
 * Renders nothing when there is no active session, which is the common case:
 * most hires are read-only records with no authority attached, and an empty
 * "no permissions" box under every card would be noise rather than
 * information.
 */
export function HireSessionRow({ tokenId }: { tokenId: string }) {
  const altana = useAltanaWallet();
  const [error, setError] = useState<string | null>(null);

  const session = useConvexQuery(
    agentSessionsApi.agentSessions.getActiveSessionForAgent,
    altana.address ? { tokenId, altanaWalletAddress: altana.address } : "skip",
  );

  if (!session) return null;

  return (
    <div className="mt-2 rounded-2xl border border-[#F3E3A6] bg-[#FEF5D6] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <CategoryGlyph color="#946B00" name="shield" size={13} strokeWidth={2.5} />
            <p className="text-[11px] font-black text-[#946B00]">
              Spending permission active
            </p>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#6E706B]">
            Up to{" "}
            <strong className="font-bold text-[#111214]">
              {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
            </strong>
            , only against {session.allowlist.map((c) => c.label).join(", ")}.
          </p>
        </div>

        <button
          className="pressable-scale min-h-[36px] shrink-0 rounded-xl border border-[#ECE8DE] bg-white px-3 text-[11px] font-black text-[#6E706B] hover:border-[#FECACA] hover:bg-[#FEE2E2] hover:text-[#B91C1C] disabled:opacity-50"
          disabled={altana.isBusy}
          onClick={() => {
            setError(null);
            void altana
              .revokeSession(session.sessionPublicKey)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              );
          }}
          type="button"
        >
          Revoke
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[10px] font-semibold leading-relaxed text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
}
