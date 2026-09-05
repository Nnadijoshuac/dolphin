const {
  withAndroidManifest,
  createRunOncePlugin,
} = require("expo/config-plugins");

/**
 * Android package visibility for wallet detection (AppKit React Native).
 *
 * Android 11 (API 30) made other installed apps invisible by default, so
 * `canOpenURL`/`queryIntentActivities` return nothing unless the package is
 * declared here. Without this block AppKit's wallet list still renders, but
 * every wallet is reported as NOT installed, so tapping one falls back to the
 * store/QR path instead of deep-linking straight into the app the user
 * already has. The iOS half of the same problem is
 * `ios.infoPlist.LSApplicationQueriesSchemes` in app.json - the two lists must
 * be kept in step, so edit them together.
 *
 * The entries below are exactly the ones Reown documents at
 * https://docs.reown.com/appkit/react-native/core/installation
 * ("Enable Wallet Detection"). Nothing has been added from memory.
 *
 * NOT YET LISTED: Binance Wallet and OKX Wallet, which matter more than most
 * of these on BSC. Their scheme/package identifiers could not be confirmed
 * against a primary source, and an unverified identifier here is a silent
 * no-op that reads like working detection (AGENTS.md §7). Add them once the
 * values are read off the WalletConnect explorer entry for each wallet.
 */
const queries = {
  package: [
    { $: { "android:name": "com.wallet.crypto.trustapp" } },
    { $: { "android:name": "io.metamask" } },
    { $: { "android:name": "me.rainbow" } },
    { $: { "android:name": "io.zerion.android" } },
    { $: { "android:name": "io.gnosis.safe" } },
    { $: { "android:name": "com.uniswap.mobile" } },
  ],
};

const withWalletQueries = (config) =>
  withAndroidManifest(config, (config) => {
    config.modResults.manifest = {
      ...config.modResults.manifest,
      queries,
    };
    return config;
  });

module.exports = createRunOncePlugin(
  withWalletQueries,
  "dolphin-wallet-queries",
  "1.0.0",
);
