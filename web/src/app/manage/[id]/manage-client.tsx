"use client";

import { DolphinLoader } from "@/components/dolphin-loader";
import { ManageView } from "@/components/manage-hire";
import { StatePanel } from "@/components/state-panel";
import { useAgent } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { convexClient } from "@/providers/convex-provider";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * ===========================================================================
 * THE EXIT. THERE WAS NONE. (2026-09-08)
 * ===========================================================================
 *
 * WHAT THE WEBSITE DID BEFORE THIS ROUTE EXISTED:
 *
 *   /my-agents rendered a row per hire with a "Manage →" affordance pointing at
 *   /agent/[id]. There was no /manage route, so that link went to the public
 *   record - which, for an agent you have already hired, renders "Manage in My
 *   agents" pointing back at /my-agents. Two controls, both labelled Manage,
 *   pointing at each other, and no management anywhere between them.
 *
 *   `cancelHire` was DECLARED in src/convex/api.ts and called from nowhere. On
 *   the website, a hire was permanent. The mobile app fixed this on 2026-09-06;
 *   the website did not, which is exactly the one-directional drift the
 *   two-frontends decision record describes.
 *
 * This is that missing screen: what the hire is, what was paid, what was
 * delivered, how it has been reviewed, and how to end it.
 *
 * ===========================================================================
 * WHAT CANCELLING DOES NOT DO, SAID BEFORE IT IS PRESSED
 * ===========================================================================
 * `cancelHire` ends the SUBSCRIPTION ROW. It does not refund or alter an
 * ERC-8183 escrow: that money is on-chain and Convex has no authority over it,
 * which is why a cancelled paid hire keeps its `paymentJobId`. Saying so in the
 * confirmation is not legal boilerplate - it is the difference between a user
 * cancelling to tidy their list and a user cancelling because they believe it
 * will get their money back.
 */
export function ManageClient({ reference }: { reference: string }) {
  const wallet = useWallet();

  if (!convexClient) {
    return (
      <div className="site-frame page-shell">
        <StatePanel
          body="NEXT_PUBLIC_CONVEX_URL is not set, so Dolphin cannot read hire records."
          state="unavailable"
          title="Hire records unavailable"
        />
      </div>
    );
  }

  if (!wallet.isConnected || !wallet.address) {
    return (
      <div className="site-frame page-shell">
        <div className="detail-card mx-auto mt-10 max-w-xl text-center">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-ink">Connect the wallet that hired this agent</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Your hires belong to your wallet. Connecting only lets Dolphin find them - it cannot spend anything.
          </p>
          <div className="mt-5 flex justify-center">
            <WalletConnectButton />
          </div>
        </div>
      </div>
    );
  }

  return <ConnectedManage address={wallet.address} reference={reference} />;
}

function ConnectedManage({
  address,
  reference,
}: {
  address: string;
  reference: string;
}) {
  const { data: agent, notFound } = useAgent(reference, { verifyOnChain: false });
  const hires = useHiredAgents(address);

  if ((agent === undefined && !notFound) || (agent && hires === undefined)) {
    return (
      <div className="site-frame page-shell flex justify-center pt-24">
        <DolphinLoader label="Loading your hire" showLabel={false} state="done" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="site-frame page-shell">
        <StatePanel
          body="There is no agent with this link, so there is nothing to manage."
          state="unavailable"
          title="Agent not found"
        />
      </div>
    );
  }

  const hire = hires?.find((record) => record.agentKey === agent.agentKey);
  if (!hire) {
    return (
      <div className="site-frame page-shell">
        <StatePanel
          body="This wallet has not hired this agent. If you hired it with a different wallet, connect that one."
          state="empty"
          title="Not hired by this wallet"
        />
      </div>
    );
  }

  return <ManageView address={address} agent={agent} hire={hire} />;
}
