# contracts/

## DolphinSwapGuard.sol — status: written and tested, NOT deployed, NOT audited

This is the only thing an agent's trade key should ever be allowed to call.

Altana session keys can pin a call's target and function, but never its arguments. So a key allowed to call PancakeSwap directly can name any recipient. The guard sits in between and fixes the arguments that matter:

| Risk | What the guard does |
| --- | --- |
| Proceeds sent to an attacker | No recipient parameter exists: it is always `msg.sender`, the calling wallet. |
| Swapping into an attacker's token | Every token on the path must be on an allow-list fixed at deployment. |
| Zero minimum output (self-sandwich) | `minOut` must be at least (1 − `maxSlippageBps`) of the router's quote, and the output actually received is checked. |
| Spending another wallet's allowance | Tokens are pulled only from `msg.sender`. |

**Known limit.** The minimum-output floor uses the pool's spot quote at execution. That can be moved within the same block by someone who can also trade the pool. A time-weighted price would close this, but it is not built.

## Tests

`test/DolphinSwapGuard.test.cjs` tries each attack against mock tokens and a mock V2 router (`test/Mocks.sol`). The last run, on 2026-09-29, passed 9 of 9. The repo takes no Hardhat dependency, so the tests run in a scratch workspace:

```
mkdir guard-tests && cd guard-tests && npm init -y
npm i hardhat@2 @nomicfoundation/hardhat-viem@2 viem@2
mkdir -p gsrc/test && cp <repo>/contracts/DolphinSwapGuard.sol gsrc/ && cp <repo>/contracts/test/* gsrc/test/
echo 'require("@nomicfoundation/hardhat-viem"); module.exports = { solidity: "0.8.24", paths: { sources: "./gsrc", tests: "./gsrc/test" } };' > hardhat.config.cjs
npx hardhat test
```

The trade-key policy and the pre-signing argument checks have their own tests: `npx tsx --test tests/trade-key-attacks.test.ts`, run from the repo root.

## Before it touches real money

1. Get an external audit.
2. Deploy to BNB Chain with the V2 router, WBNB, Dolphin's verified token list, and `maxSlippageBps` (300 is suggested). Verify the source on BscScan.
3. Switch `convex/lib/tradeKeyPolicy.ts` so the key's calls are the guard's three functions and its allowances go to the guard instead of the router. Then switch `convex/autotrade.ts` to build guard calls.
4. Re-run both test suites and one small live trade.
