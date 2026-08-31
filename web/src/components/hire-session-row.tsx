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
    <div className="mb-5 border-l-2 border-accent bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <CategoryGlyph color="#654b00" name="shield" size={13} strokeWidth={2} />
            <p className="text-xs font-semibold text-accent-ink">
              Spending permission active
            </p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            Up to{" "}
            <strong className="font-semibold text-ink">
              {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
            </strong>
            , only against {session.allowlist.map((c) => c.label).join(", ")}.
          </p>
        </div>

        <button
          className="interactive min-h-9 shrink-0 text-xs font-medium text-muted underline-offset-4 hover:text-danger hover:underline disabled:opacity-50"
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
          Revoke permission
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[0.7rem] font-medium leading-5 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
