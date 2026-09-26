import { getAddress, parseAbi, parseEventLogs, type Log } from "viem";

/**
 * WHAT A DOLPHIN WALLET TRANSACTION ACTUALLY MOVED, read from its receipt.
 * (2026-09-26)
 *
 * The owner's rule: every action the Dolphin Wallet takes is recorded in
 * Agent activity. What is recorded comes from here, never from the browser's
 * account of what it sent: a trade row says what the CHAIN says left and
 * entered the wallet.
 *
 * Native BNB leaves no Transfer log. It is seen through WBNB instead: a
 * PancakeSwap router wrapping the BNB the wallet paid (WBNB `Deposit`, dst =
 * router) or unwrapping what the wallet receives (WBNB `Withdrawal`, src =
 * router). A plain native send - a BNB withdrawal - leaves no log at all, and
 * is recorded with its amount unknown rather than a number taken on trust.
 */

export const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/** PancakeSwap's V2 and V3 routers, as verified in web/src/wallet/pancakeswap-trade.ts. */
export const PANCAKE_ROUTERS = [
  "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
] as const;

const EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
]);

/** One asset that moved. `token` null is native BNB. */
export type Movement = { token: string | null; amountRaw: string };

function add(into: Map<string, bigint>, key: string, value: bigint) {
  into.set(key, (into.get(key) ?? BigInt(0)) + value);
}

function toMovements(totals: Map<string, bigint>): Movement[] {
  return [...totals.entries()]
    .filter(([, value]) => value > BigInt(0))
    .map(([key, value]) => ({ token: key === "native" ? null : key, amountRaw: value.toString() }));
}

/**
 * What left the wallet and what entered it in one transaction.
 *
 * A token that both left and entered (dust returned, say) is netted, so each
 * token appears on one side only.
 */
export function readWalletMovements(logs: readonly Log[], wallet: string): { sent: Movement[]; received: Movement[] } {
  const me = getAddress(wallet);
  const routers = new Set<string>(PANCAKE_ROUTERS.map((router) => getAddress(router)));
  const wbnb = getAddress(WBNB_ADDRESS);
  const out = new Map<string, bigint>();
  const inbound = new Map<string, bigint>();
  const events = parseEventLogs({ abi: EVENTS, logs: logs as Log[], strict: false });

  /*
   * A router's wrap or unwrap names the ROUTER, not the wallet. Checked
   * against the real 0.05 U trade: without this, any address asked about that
   * transaction "received" its 0.0000647 BNB. So native BNB counts only when
   * this wallet also moved a token in the same transaction - the other leg
   * of its own swap.
   */
  const walletMovedAToken = events.some((event) => {
    if (event.eventName !== "Transfer") return false;
    const args = event.args as { from?: string; to?: string };
    return (args.from && getAddress(args.from) === me) || (args.to && getAddress(args.to) === me);
  });

  for (const event of events) {
    const token = getAddress(event.address);
    if (event.eventName === "Transfer") {
      const args = event.args as { from?: string; to?: string; value?: bigint };
      if (!args.from || !args.to || args.value === undefined) continue;
      if (getAddress(args.from) === me) add(out, token, args.value);
      if (getAddress(args.to) === me) add(inbound, token, args.value);
    } else if (!walletMovedAToken) {
      continue;
    } else if (token === wbnb && event.eventName === "Deposit") {
      const args = event.args as { dst?: string; wad?: bigint };
      if (args.dst && args.wad !== undefined && routers.has(getAddress(args.dst))) add(out, "native", args.wad);
    } else if (token === wbnb && event.eventName === "Withdrawal") {
      const args = event.args as { src?: string; wad?: bigint };
      if (args.src && args.wad !== undefined && routers.has(getAddress(args.src))) add(inbound, "native", args.wad);
    }
  }

  for (const key of new Set([...out.keys(), ...inbound.keys()])) {
    const sent = out.get(key) ?? BigInt(0);
    const got = inbound.get(key) ?? BigInt(0);
    if (sent >= got) {
      out.set(key, sent - got);
      inbound.delete(key);
    } else {
      inbound.set(key, got - sent);
      out.delete(key);
    }
  }

  return { sent: toMovements(out), received: toMovements(inbound) };
}

/** Token transfers out of the wallet to one recipient: a withdrawal's evidence. */
export function readTokenSendsTo(logs: readonly Log[], wallet: string, recipient: string): Movement[] {
  const me = getAddress(wallet);
  const them = getAddress(recipient);
  const totals = new Map<string, bigint>();
  for (const event of parseEventLogs({ abi: EVENTS, logs: logs as Log[], strict: false })) {
    if (event.eventName !== "Transfer") continue;
    const args = event.args as { from?: string; to?: string; value?: bigint };
    if (!args.from || !args.to || args.value === undefined) continue;
    if (getAddress(args.from) === me && getAddress(args.to) === them) add(totals, getAddress(event.address), args.value);
  }
  return toMovements(totals);
}
