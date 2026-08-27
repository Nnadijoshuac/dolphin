/**
 * Spike B: perform an Altana session lifecycle on BNB Smart Chain testnet.
 *
 * Safety:
 * - Use only a disposable testnet key in ALTANA_TEST_PRIVATE_KEY.
 * - The key is read from the process environment and is never printed.
 * - The session can call only the identity precompile and spend at most one wei
 *   of native currency per day.
 * - A revocation is attempted after any successful grant, even if execution fails.
 *
 * This script reports observed results. It does not claim the lifecycle passed
 * unless grant, scoped execution, revocation, and post-revoke rejection all
 * complete against chain 97.
 */

import {
  BNB_TESTNET,
  createClient,
  signerFromPrivateKey,
} from "@altananetwork/sdk";
import { createPublicClient, formatEther, http } from "viem";

const CHAIN_ID = 97;
const IDENTITY_PRECOMPILE = "0x0000000000000000000000000000000000000004";
const TEST_CALL_DATA = "0x446f6c7068696e"; // UTF-8 "Dolphin".
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/0x[0-9a-fA-F]{64}/g, "[redacted-private-key]");
}

function requireConfirmed(label, result) {
  if (result.status !== "CONFIRMED") {
    throw new Error(`${label} returned ${result.status}.`);
  }
}

function recordTransaction(transactions, step, transactionHash) {
  if (transactionHash) {
    transactions.push({ step, transactionHash });
  }
}

async function runSpikeB() {
  const privateKey = process.env.ALTANA_TEST_PRIVATE_KEY?.trim();

  if (!privateKey || !PRIVATE_KEY_PATTERN.test(privateKey)) {
    console.error(
      [
        "Spike B did not run: ALTANA_TEST_PRIVATE_KEY is missing or invalid.",
        "Use a disposable chain-97 key only; never use a production wallet key.",
        "The script first prints the derived wallet address so it can be funded",
        "from https://testnet.bnbchain.org/faucet-smart before any grant.",
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }

  const publicClient = createPublicClient({
    chain: BNB_TESTNET.chain,
    transport: http(BNB_TESTNET.publicRpcUrl),
  });
  const client = createClient({
    chains: [BNB_TESTNET],
    defaultChainId: CHAIN_ID,
  });
  const admin = signerFromPrivateKey(privateKey);
  const wallet = await client.createWallet({ signer: admin });
  const balance = await publicClient.getBalance({ address: wallet.address });
  const sameAddress = wallet.address.toLowerCase() === admin.address.toLowerCase();

  console.log("=== Spike B preflight ===");
  console.log(`Chain: BNB Smart Chain testnet (${CHAIN_ID})`);
  console.log(`Admin address: ${admin.address}`);
  console.log(`Altana wallet address: ${wallet.address}`);
  console.log(`Wallet equals signer EOA: ${sameAddress}`);
  console.log(`Wallet balance: ${formatEther(balance)} test BNB`);

  if (balance === 0n) {
    console.error(
      [
        "Spike B stopped before any transaction because the derived wallet is unfunded.",
        `Fund ${wallet.address} with test BNB, then run this script again.`,
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }

  const transactions = [];
  let session;
  let lifecycleError;

  try {
    console.log("\n1. Granting a registered, scoped session...");
    session = await client.grantSession({
      wallet,
      signer: admin,
      chainId: CHAIN_ID,
      register: true,
      permissions: {
        calls: [{ to: IDENTITY_PRECOMPILE }],
        spend: [{ limit: 1n, period: "day" }],
      },
      expiry: Math.floor(Date.now() / 1_000) + 60 * 60,
    });
    recordTransaction(transactions, "grant", session.transactionHash);
    console.log(`Session public key: ${session.publicKey}`);
    console.log(
      `Grant transaction: ${session.transactionHash ?? "relay did not surface a hash"}`,
    );

    console.log("\n2. Executing the harmless, allowlisted precompile call...");
    const execution = await client.execute({
      session,
      chainId: CHAIN_ID,
      calls: {
        to: IDENTITY_PRECOMPILE,
        data: TEST_CALL_DATA,
        value: 0n,
      },
    });
    recordTransaction(transactions, "execute", execution.transactionHash);
    requireConfirmed("Scoped execution", execution);
    console.log(
      `Execution transaction: ${execution.transactionHash ?? "relay did not surface a hash"}`,
    );
  } catch (error) {
    lifecycleError = error;
  }

  if (session) {
    try {
      console.log("\n3. Revoking the session...");
      const revocation = await client.revokeSession({
        wallet,
        signer: admin,
        session,
        chainId: CHAIN_ID,
      });
      recordTransaction(transactions, "revoke", revocation.transactionHash);
      requireConfirmed("Revocation", revocation);
      console.log(
        `Revocation transaction: ${revocation.transactionHash ?? "relay did not surface a hash"}`,
      );

      console.log("\n4. Confirming the revoked session can no longer execute...");
      let rejectionObserved = false;

      try {
        const postRevokeExecution = await client.execute({
          session,
          chainId: CHAIN_ID,
          calls: {
            to: IDENTITY_PRECOMPILE,
            data: TEST_CALL_DATA,
            value: 0n,
          },
        });
        recordTransaction(
          transactions,
          "post-revoke-attempt",
          postRevokeExecution.transactionHash,
        );
        rejectionObserved = postRevokeExecution.status === "FAILED";
      } catch (error) {
        rejectionObserved = true;
        console.log(`Post-revoke rejection: ${safeErrorMessage(error)}`);
      }

      if (!rejectionObserved) {
        throw new Error("The revoked session was not rejected.");
      }

      console.log("Post-revoke execution was rejected as expected.");
    } catch (error) {
      lifecycleError ??= error;
    }
  }

  console.log("\n=== Observed transaction receipts ===");
  if (transactions.length === 0) {
    console.log("No transaction hash was surfaced by the relay.");
  } else {
    for (const transaction of transactions) {
      console.log(
        `${transaction.step}: ${BNB_TESTNET.explorer}/tx/${transaction.transactionHash}`,
      );
    }
  }
  console.log(`Hashes surfaced: ${transactions.length}`);

  if (lifecycleError) {
    throw lifecycleError;
  }

  console.log("\nSpike B passed against BNB Smart Chain testnet.");
  console.log(
    sameAddress
      ? "Observed custody shape: the Altana wallet uses the existing signer EOA address."
      : "Observed custody shape: the Altana wallet address differs from the signer EOA.",
  );
}

runSpikeB().catch((error) => {
  console.error(`\nSpike B failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
