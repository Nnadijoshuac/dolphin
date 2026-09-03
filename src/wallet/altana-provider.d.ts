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
 * value and the imports are static. Platform-extension resolution keeps each
 * target to the implementation it can actually run.
 *
 * NOTE ON AN EARLIER REASON THAT NO LONGER APPLIES. This comment used to argue
 * the split mattered chiefly to keep @altananetwork/sdk (and its porto/ox
 * tree) out of the Android bundle, since native "has no way to use it at all"
 * and shipping it was pure cost. That stopped being true at SDK 0.9.0: the
 * native provider now uses the SDK for real, via the `webAuthn` option and
 * altana-passkey-native.ts, so the SDK is expected in the native bundle and
 * finding it there is not a regression. The split still earns its place - the
 * two providers have genuinely different storage, availability and rpId
 * behaviour - it just no longer earns it on bundle size.
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
