/**
 * Live verification for Task 2 / Task 4 (website).
 *
 * Drives the real production build in a real Chromium with a REAL WebAuthn
 * ceremony. The authenticator is Chrome's built-in virtual authenticator
 * (CDP WebAuthn domain) rather than a physical Touch ID sensor, so no human
 * has to press a fingerprint reader — but `navigator.credentials.create()` and
 * `.get()` really run, the SDK's real createPasskeyWallet / recoverFromPasskey
 * paths really execute, and the P256 keys are really generated. Nothing about
 * the SDK is stubbed.
 *
 * Usage: node scripts/verify-web-altana.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";

function log(step, detail = "") {
  console.log(`${step.padEnd(46)} ${detail}`);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // --- install a virtual WebAuthn authenticator ---------------------------
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  log("virtual authenticator installed", authenticatorId);

  console.log("\n=== 1. LAND ON /wallet ===");
  await page.goto(`${BASE_URL}/wallet`, { waitUntil: "networkidle" });
  log("url", page.url());
  log(
    "navigator.credentials present",
    String(await page.evaluate(() => Boolean(navigator.credentials?.create))),
  );

  const createButton = page.getByRole("button", { name: /create with a passkey/i });
  const recoverButton = page.getByRole("button", { name: /recover it/i });
  log("create CTA visible", String(await createButton.isVisible()));
  log("recover CTA visible", String(await recoverButton.isVisible()));
  log(
    "separate-wallet notice present",
    String(await page.getByText(/not.*your MetaMask/i).first().isVisible()),
  );

  console.log("\n=== 2. CREATE A REAL PASSKEY WALLET ===");
  await createButton.click();
  await page
    .getByText(/Wallet address/i)
    .first()
    .waitFor({ state: "visible", timeout: 90_000 });

  const address = await page.evaluate(() => {
    const stored = window.localStorage.getItem("dolphin.altana.credential.v1");
    return stored ? JSON.parse(stored).address : null;
  });
  log("wallet address (from the page)", address ?? "NOT FOUND");

  const credential = await page.evaluate(() => {
    const stored = window.localStorage.getItem("dolphin.altana.credential.v1");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      kind: parsed.credential?.kind,
      credentialIdLength: parsed.credential?.id?.length ?? 0,
      publicKeyLength: parsed.credential?.publicKey?.length ?? 0,
      rpId: parsed.credential?.rpId ?? "(default: origin host)",
      hasPrivateKey: Object.keys(parsed.credential ?? {}).some((k) =>
        k.toLowerCase().includes("private"),
      ),
    };
  });
  log("credential.kind", credential?.kind ?? "?");
  log("credential id length", String(credential?.credentialIdLength));
  log("P256 public key length (hex)", String(credential?.publicKeyLength));
  log("rpId", credential?.rpId ?? "?");
  log("stores ANY private key?", String(credential?.hasPrivateKey));

  const credentialsOnAuthenticator = await cdp.send("WebAuthn.getCredentials", {
    authenticatorId,
  });
  log(
    "credentials on the authenticator",
    String(credentialsOnAuthenticator.credentials.length),
  );

  console.log("\n=== 3. READ THE REAL BALANCE ===");
  // The assets row renders whatever the live read returned.
  const assetsText = await page
    .locator("section")
    .filter({ hasText: "Assets" })
    .first()
    .innerText();
  console.log(assetsText.split("\n").filter(Boolean).map((l) => `   ${l}`).join("\n"));

  console.log("\n=== 4. GRANTED SESSIONS VIEW ===");
  const authorized = await page
    .locator("div")
    .filter({ hasText: /What you've authorized/ })
    .last()
    .innerText();
  console.log(authorized.split("\n").filter(Boolean).slice(0, 8).map((l) => `   ${l}`).join("\n"));

  console.log("\n=== 5. FUNDING PATH ===");
  const funding = await page.getByText(/Fund this wallet/i).first();
  log("funding CTA visible", String(await funding.isVisible().catch(() => false)));

  console.log("\n=== 6. SURVIVES A RELOAD ===");
  await page.reload({ waitUntil: "networkidle" });
  const addressAfterReload = await page.evaluate(() => {
    const stored = window.localStorage.getItem("dolphin.altana.credential.v1");
    return stored ? JSON.parse(stored).address : null;
  });
  log("same address after reload", String(addressAfterReload === address));

  console.log("\n=== 7. RECOVER FROM PASSKEY (fresh browser context) ===");
  // Wipe local state so recovery has to come from the authenticator + chain,
  // exactly as it would on a new device.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  log(
    "back to the create screen",
    String(await page.getByRole("button", { name: /create with a passkey/i }).isVisible()),
  );

  try {
    await page.getByRole("button", { name: /recover it/i }).click();
    await page
      .getByText(/Wallet address/i)
      .first()
      .waitFor({ state: "visible", timeout: 90_000 });
    const recovered = await page.evaluate(() => {
      const stored = window.localStorage.getItem("dolphin.altana.credential.v1");
      return stored ? JSON.parse(stored).address : null;
    });
    log("recovered address", recovered ?? "NOT FOUND");
    log("matches the created wallet", String(recovered === address));
  } catch (error) {
    log("recovery FAILED", error.message.split("\n")[0]);
    const shown = await page
      .locator("p")
      .filter({ hasText: /./ })
      .allInnerTexts()
      .catch(() => []);
    const errorLine = shown.find((t) => /revert|not found|keystore|no |fail/i.test(t));
    if (errorLine) log("error shown to the user", errorLine.slice(0, 160));
  }

  console.log("\n=== ERRORS ===");
  log("console errors", String(consoleErrors.length));
  consoleErrors.slice(0, 8).forEach((e) => console.log(`   - ${e.slice(0, 180)}`));
  log("page errors", String(pageErrors.length));
  pageErrors.slice(0, 8).forEach((e) => console.log(`   - ${e.slice(0, 180)}`));

  await browser.close();
}

main().catch((error) => {
  console.error("\nVerification script failed:", error);
  process.exitCode = 1;
});
