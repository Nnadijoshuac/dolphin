"use client";

import { AssetLogo } from "@/components/wallet-withdraw";
import { HIDDEN, rateKey, type Holding, type Rates } from "@/hooks/use-wallet-holdings";
import { formatUsdCents } from "@/wallet/bnb-price";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { usdCents } from "@/wallet/token-usd";

/**
 * Every asset held, with its amount and dollar value - the phone's Assets tab, shared with the
 * desktop wallet (owner, 2026-10-03). BNB and U always show, so the wallet's two working currencies
 * are never missing; any other token once it is held.
 */
export function TokenList({ holdings, rates, hidden }: { holdings: Holding[]; rates: Rates; hidden: boolean }) {
  const rows = holdings.filter((h) => h.token.symbol === "BNB" || h.token.symbol === "U" || h.raw > BigInt(0) || !h.read);
  return (
    <ul className="pw-tokens">
      {rows.map(({ token, raw, read }) => {
        const rate = rates.get(rateKey(token.address));
        return (
          <li className="pw-token" key={token.symbol}>
            {token.symbol === "BNB" || token.symbol === "U" ? (
              <AssetLogo asset={token.symbol} size={36} />
            ) : (
              <span aria-hidden="true" className="pw-token__badge">{token.symbol.slice(0, 1)}</span>
            )}
            <span className="pw-token__name">
              <strong>{token.symbol}</strong>
              <span>{!read ? "Unavailable" : hidden ? HIDDEN : formatTokenAmount(raw, token.decimals)}</span>
            </span>
            <span className="pw-token__value">{!read || hidden ? "" : rate ? formatUsdCents(usdCents(raw, token.decimals, rate)) : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}
