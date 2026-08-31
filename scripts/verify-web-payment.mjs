/**
 * Live verification for the paid-hire flow (website).
 *
 * Same approach as scripts/verify-web-altana.mjs and for the same reason: a
 * real Chromium against the real production build, with Chrome's virtual
 * WebAuthn authenticator so `navigator.credentials.create()` genuinely runs
 * and the SDK's real passkey path really executes. Nothing is stubbed.
 *
 * WHAT THIS PROVES, and what it deliberately does not.
 *
 * It drives every step of a paid hire that does not require funds:
 *   - the payment step renders on a real agent page
 *   - "get a price" reaches a real third-party seller through the Convex relay
 *     and comes back with a real wallet-signed quote
 *   - the quoted token's balance is read from the real Dolphin Wallet on BSC
 *   - a wallet with no balance is told exactly what it is short of, and the
 *     Pay button is disabled rather than allowed to fail on-chain
 *
 * It does NOT fund a job. That costs real money on BSC mainnet and is the
 * project owner's call, asked explicitly and answered "build now, fund later"
 * this session. The funded round-trip is the one piece of this flow nobody
 * here has watched happen, and it is recorded as such rather than implied.
 *
 * Usage: node scripts/verify-web-payment.mjs [baseUrl] [tokenId]
 */

import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
// 302257 = Brain on BNB Venus Health Factor Monitor: a real agent that really
// charges (0.10 $U over ERC-8183, verified live this session).
const TOKEN_ID = process.argv[3] ?? "302257";

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

  console.log("\n=== 1. CREATE A DOLPHIN WALLET ===");
  await page.goto(`${BASE_URL}/wallet`, { waitUntil: "networkidle" });
  const createButton = page.getByRole("button", { name: /create with a passkey/i });
  await createButton.first().click();
  await page.waitForTimeout(6000);
  const walletAddress = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem("dolphin.altana.credential.v1");
      return raw ? JSON.parse(raw).address : null;
    } catch {
      return null;
    }
  });
  log("wallet address", walletAddress ?? "NONE — wallet creation failed");
  if (!walletAddress) throw new Error("No wallet was created; cannot verify payment.");

  console.log("\n=== 2. THE PAYMENT STEP RENDERS ON A REAL AGENT ===");
  await page.goto(`${BASE_URL}/agent/${TOKEN_ID}`, { waitUntil: "networkidle" });
  const quoteButton = page.getByRole("button", { name: /get a price from this agent/i });
  await quoteButton.waitFor({ state: "visible", timeout: 30000 });
  log("payment step visible", "yes");
  const taskBox = page.locator("textarea").first();
  log("task is editable and prefilled", String((await taskBox.inputValue()).length > 0));

  console.log("\n=== 3. ASK A REAL SELLER FOR A REAL PRICE ===");
  await quoteButton.click();
  // Through Convex -> the seller's own endpoint -> back. Slower than a local
  // call because it really leaves the building.
  await page.getByText(/the agent quoted this price/i).waitFor({
    state: "visible",
    timeout: 90000,
  });
  log("quote returned", "yes");

  const terms = await page.evaluate(() => {
    const rows = {};
    document.querySelectorAll("dl div").forEach((row) => {
      const dt = row.querySelector("dt")?.textContent?.trim();
      const dd = row.querySelector("dd")?.textContent?.trim();
      if (dt && dd) rows[dt] = dd;
    });
    return rows;
  });
  for (const [key, value] of Object.entries(terms)) log(`  ${key}`, value);

  console.log("\n=== 4. INSUFFICIENT BALANCE IS STATED, NOT DISCOVERED ON-CHAIN ===");
  const shortfall = page.getByText(/not enough .* to pay this/i);
  const shortfallVisible = await shortfall.isVisible().catch(() => false);
  log("shortfall warning shown", String(shortfallVisible));
  if (shortfallVisible) {
    log("  message", (await shortfall.locator("..").textContent())?.trim().slice(0, 220));
  }
  const payButton = page.getByRole("button", { name: /^pay /i });
  log("pay button disabled", String(await payButton.isDisabled()));

  console.log("\n=== 5. PAGE HEALTH ===");
  log("console errors", String(consoleErrors.length));
  log("page errors", String(pageErrors.length));
  for (const error of [...consoleErrors, ...pageErrors].slice(0, 5)) log("  ", error);

  console.log("\n=== NOT VERIFIED HERE ===");
  console.log("A funded job. That spends real $U on BSC mainnet and needs the");
  console.log("project owner's go-ahead, which this session did not have.");

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
