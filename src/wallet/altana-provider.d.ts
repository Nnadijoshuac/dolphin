/**
 * Type-only declaration for the Altana wallet module, so `./altana-provider`
 * resolves for BOTH toolchains without a tsconfig change:
 *
 *   TypeScript  resolves this .d.ts and gets one shared signature.
 *   Metro       resolves altana-provider.web.tsx on web and
 *               altana-provider.native.tsx on native, via its ordinary
 *               platform-extension resolution.
 *
 * WHY NOT the runtime router that wallet-provider.ts uses. That pattern
 * (`import * as Native`, `import * as Web`, then branch on Platform.OS) makes
 * Metro bundle BOTH modules on BOTH platforms, because the branch is a runtime
 * value and the imports are static. Measured this session: with a router in
 * place, `expo export --platform android` shipped @altananetwork/sdk into the
 * Android bundle - 4 hits for createPasskeyWallet and the Altana relay URL -
 * even though the native code path can never call any of it. Removing the
 * router removed it.
 *
 * That matters more here than it does for the Reown wallet: the SDK's tree
 * (porto, ox) is browser-oriented, and native has no way to use it at all, so
 * shipping it to a phone is pure cost and pure risk.
 *
 * HANDOVER.md records an earlier attempt at platform resolution being reverted
 * because it needed tsconfig's `moduleSuffixes`, which broke expo-video's own
 * platform type declarations. This approach needs no tsconfig change at all -
 * a plain .d.ts beside the implementations is enough.
 */
import type { PropsWithChildren } from "react";

import type { AltanaWalletValue } from "./altana-types";

export declare function AltanaWalletProvider(
  props: PropsWithChildren,
): React.JSX.Element;

export declare function useAltanaWallet(): AltanaWalletValue;

export * from "./altana-types";
