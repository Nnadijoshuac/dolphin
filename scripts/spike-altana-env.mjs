/**
 * Task 0 investigation spike — Session 6.
 *
 * Answers, empirically rather than from the docs alone:
 *   1. Is `createPasskey` really browser-gated? (what exactly does it throw?)
 *   2. Does the headless P256 passkey path work outside a browser at all?
 *   3. Does `createWallet` produce a counterfactual address with no funding,
 *      on BOTH BNB mainnet (56) and BNB testnet (97)?
 *   4. Does `balances` read successfully against both networks?
 *   5. Are the Altana relays reachable from this network at all?
 *
 * Read-only and free: no transaction is sent, nothing is funded, and no
 * private key is required. Everything here is either a pure local
 * computation or an eth_call.
 */

import {
  BNB,
  BNB_TESTNET,
  RELAY_URL,
  TESTNET_RELAY_URL,
  createClient,
  createHeadlessPasskey,
  createPasskey,
  createPrivateKeySigner,
  signerFromPasskey,
} from "@altananetwork/sdk";

function line(label, value) {
  console.log(`${label.padEnd(38)} ${value}`);
}

async function main() {
  console.log("=== Altana SDK environment probe (Session 6, Task 0) ===");
  line("Runtime", `node ${process.version} on ${process.platform}`);
  line("navigator defined?", String(typeof navigator !== "undefined"));
  line(
    "navigator.credentials defined?",
    String(typeof navigator !== "undefined" && Boolean(navigator?.credentials)),
  );

  // --- 1. Is createPasskey browser-gated, and how does it fail? -----------
  console.log("\n--- 1. createPasskey outside a browser ---");
  try {
    await createPasskey({ name: "Dolphin probe" });
    console.log("UNEXPECTED: createPasskey resolved outside a browser.");
  } catch (error) {
    line("threw", error?.constructor?.name ?? "unknown");
    line("message", error instanceof Error ? error.message : String(error));
  }

  // --- 2. Headless passkey (P256, no OS keychain) ------------------------
  console.log("\n--- 2. createHeadlessPasskey ---");
  const headless = createHeadlessPasskey();
  line("signer.type", headless.type);
  line("credential.kind", headless.credential.kind);
  line("publicKey length (hex chars)", String(headless.credential.publicKey.length));
  line("signer.address", headless.address);
  const rehydrated = signerFromPasskey(headless.credential);
  line("rehydrates via signerFromPasskey", String(rehydrated.type === "passkey"));

  // --- 3. Counterfactual wallet creation, both networks -------------------
  console.log("\n--- 3. createWallet (counterfactual, unfunded) ---");
  for (const network of [BNB, BNB_TESTNET]) {
    const label = network.chainId === 56 ? "BNB mainnet (56)" : "BNB testnet (97)";
    const client = createClient({ chains: [network], defaultChainId: network.chainId });
    try {
      // A fresh private-key signer, generated in-process and discarded when
      // this script exits. Nothing is funded and nothing is broadcast.
      const signer = createPrivateKeySigner();
      const wallet = await client.createWallet({ signer });
      line(`${label} wallet address`, wallet.address);
      line(`${label} equals signer EOA`, String(wallet.address.toLowerCase() === signer.address.toLowerCase()));

      const balance = await client.balances({ wallet, chainId: network.chainId });
      line(`${label} native balance (wei)`, String(balance.native));
    } catch (error) {
      line(`${label} FAILED`, error instanceof Error ? error.message : String(error));
    }
  }

  // --- 4. Headless passkey wallet on testnet -----------------------------
  console.log("\n--- 4. createWallet with a headless passkey signer ---");
  try {
    const client = createClient({ chains: [BNB_TESTNET], defaultChainId: 97 });
    const wallet = await client.createWallet({ signer: createHeadlessPasskey() });
    line("passkey wallet address", wallet.address);
    const balance = await client.balances({ wallet, chainId: 97 });
    line("passkey wallet balance (wei)", String(balance.native));
  } catch (error) {
    line("FAILED", error instanceof Error ? error.message : String(error));
  }

  // --- 5. Relay reachability ---------------------------------------------
  console.log("\n--- 5. Relay reachability from this network ---");
  for (const url of [RELAY_URL, TESTNET_RELAY_URL]) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      line(url, `HTTP ${response.status}`);
    } catch (error) {
      line(url, `unreachable — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error("\nProbe failed:", error);
  process.exitCode = 1;
});
