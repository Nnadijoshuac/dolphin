/**
 * The WebAuthn relying-party id a Dolphin Wallet's passkey is scoped to.
 *
 * NATIVE-ONLY, and deliberately not in altana-policy.ts: that file is
 * hand-mirrored byte-for-byte with web/src/wallet/altana-policy.ts (see its
 * header), and the web target has no use for this - a browser defaults the
 * relying party to its own origin host. Putting it there would break the
 * mirror to say something only one platform can act on.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VALUE MATTERS MORE THAN IT LOOKS
 * ---------------------------------------------------------------------------
 * Three separate things key off this one string:
 *
 *   1. WHETHER THE OS WILL PLAY AT ALL. iOS and Android only run a passkey
 *      ceremony for a domain the app has proved it owns. That proof is two
 *      files served over HTTPS from this exact host:
 *
 *        https://<rpId>/.well-known/apple-app-site-association
 *          {"webcredentials":{"apps":["<TEAM_ID>.com.nnadijoshuac.dolphin"]}}
 *
 *        https://<rpId>/.well-known/assetlinks.json
 *          [{"relation":["delegate_permission/common.get_login_creds"],
 *            "target":{"namespace":"android_app",
 *                      "package_name":"com.nnadijoshuac.dolphin",
 *                      "sha256_cert_fingerprints":["<SIGNING CERT SHA-256>"]}}]
 *
 *      plus the matching `ios.associatedDomains` entry in app.json. Without
 *      them the sheet does not appear and creation fails at the OS, before any
 *      Dolphin or Altana code runs. This is a hosting task, not a code one -
 *      it is called out here because nothing in this repo can satisfy it.
 *
 *   2. WHETHER IT IS THE SAME WALLET AS ON THE WEB. A passkey is scoped to its
 *      relying party, so a native build that uses the host the web build is
 *      served from reaches the SAME passkey, and therefore the same Dolphin
 *      Wallet, that a browser does. A different value here would silently make
 *      the phone a second, unrelated wallet - and "it is the same wallet,
 *      reachable from the same passkey" is a promise this app has been making
 *      in copy since before native could keep it.
 *
 *   3. WHETHER AN EXISTING WALLET STILL OPENS. Altana bakes the rpId into the
 *      credential and needs it at every later signature (verified in
 *      @altananetwork/sdk 0.9.0: passkeyToPortoKey passes credential.rpId
 *      through to porto, which passes it to ox). Changing this value after
 *      wallets exist does not migrate them - it hides them.
 *
 * So: set it once, and treat it as frozen.
 */

/**
 * The host the Expo web export is published on
 * (.github/workflows/deploy-web.yml -> GitHub Pages), which is what makes the
 * native build and the website share one passkey. A relying-party id is a bare
 * host: no scheme, no port, no path - the `/dolphin/` the site lives under is
 * correctly absent.
 */
const DEFAULT_ALTANA_RP_ID = "nnadijoshuac.github.io";

/**
 * Overridable because the association files above have to be served from
 * whatever host is used, and that is a deployment fact rather than a code one -
 * a custom domain, or a staging host, should not need a source change. Read
 * through `EXPO_PUBLIC_` so Expo inlines it at build time on native.
 *
 * IF YOU SET THIS, SET app.json's `ios.associatedDomains` TO MATCH. They are
 * two halves of one claim - this value is the domain the app ASKS the OS for,
 * that entitlement is the domain the OS will GRANT - and iOS silently declines
 * the ceremony when they disagree. app.json is static JSON and cannot read the
 * environment, so the pairing is by hand; the default below is what the
 * checked-in entitlement names.
 */
export const ALTANA_RP_ID: string =
  process.env.EXPO_PUBLIC_ALTANA_RP_ID?.trim() || DEFAULT_ALTANA_RP_ID;

/** True when the value came from the environment rather than the default. */
export const ALTANA_RP_ID_IS_OVERRIDDEN: boolean =
  ALTANA_RP_ID !== DEFAULT_ALTANA_RP_ID;
