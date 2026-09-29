/**
 * DolphinSwapGuard against the attacks the mentor review named, on Hardhat's
 * local chain with mock tokens and a mock V2 router (Mocks.sol).
 *
 * Run: see contracts/README.md (Hardhat 2 + @nomicfoundation/hardhat-viem in a
 * scratch workspace - the repo does not take Hardhat as a dependency).
 */
const assert = require("node:assert/strict");
const { viem } = require("hardhat");
const { parseEther, getAddress } = require("viem");

async function setup() {
  const [wallet, attacker, other] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const wbnb = await viem.deployContract("MockToken");
  const usdt = await viem.deployContract("MockToken");
  const cake = await viem.deployContract("MockToken");
  const evil = await viem.deployContract("MockToken");
  const router = await viem.deployContract("MockRouter");
  const guard = await viem.deployContract("DolphinSwapGuard", [router.address, wbnb.address, [usdt.address, cake.address], 300]);
  // The router's inventory, and the wallet's funds.
  for (const token of [cake, usdt, evil, wbnb]) await token.write.mint([router.address, parseEther("1000000")]);
  await wallet.sendTransaction({ to: router.address, value: parseEther("100") });
  await usdt.write.mint([wallet.account.address, parseEther("100")]);
  await usdt.write.approve([guard.address, parseEther("100")], { account: wallet.account });
  const asGuard = (client) => viem.getContractAt("DolphinSwapGuard", guard.address, { client: { wallet: client } });
  return { wallet, attacker, other, publicClient, wbnb, usdt, cake, evil, router, guard, asGuard };
}

async function reverts(promise, name) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message ?? error), new RegExp(name));
    return true;
  });
}

describe("DolphinSwapGuard", () => {
  it("a normal swap pays the caller and nobody else", async () => {
    const { wallet, usdt, cake, router, guard } = await setup();
    await guard.write.swapTokens([[usdt.address, cake.address], parseEther("10"), parseEther("19.5")], { account: wallet.account });
    assert.equal(await cake.read.balanceOf([wallet.account.address]), parseEther("20"));
    assert.equal(getAddress(await router.read.lastRecipient()), getAddress(wallet.account.address));
  });

  it("ATTACK: there is no way to name another recipient - an attacker calling it spends only their own funds", async () => {
    const { attacker, usdt, cake, asGuard, wallet } = await setup();
    const guardAsAttacker = await asGuard(attacker);
    // The victim approved the guard, but the guard pulls only from msg.sender.
    await reverts(guardAsAttacker.write.swapTokens([[usdt.address, cake.address], parseEther("10"), parseEther("19.5")]), "");
    assert.equal(await usdt.read.balanceOf([wallet.account.address]), parseEther("100"), "the victim's funds did not move");
  });

  it("ATTACK: swapping into a token that is not allow-listed is refused", async () => {
    const { wallet, usdt, evil, guard } = await setup();
    await reverts(guard.write.swapTokens([[usdt.address, evil.address], parseEther("10"), parseEther("19.5")], { account: wallet.account }), "TokenNotAllowed");
  });

  it("ATTACK: routing through a non-allow-listed token in the middle is refused", async () => {
    const { wallet, usdt, cake, evil, guard } = await setup();
    await reverts(guard.write.swapTokens([[usdt.address, evil.address, cake.address], parseEther("10"), parseEther("39")], { account: wallet.account }), "TokenNotAllowed");
  });

  it("ATTACK: a zero or too-low minimum output is refused", async () => {
    const { wallet, usdt, cake, guard } = await setup();
    await reverts(guard.write.swapTokens([[usdt.address, cake.address], parseEther("10"), 0n], { account: wallet.account }), "MinimumTooLow");
    // Quote is 20; 3% slippage floor is 19.4.
    await reverts(guard.write.swapTokens([[usdt.address, cake.address], parseEther("10"), parseEther("19")], { account: wallet.account }), "MinimumTooLow");
  });

  it("ATTACK: a router that delivers less than the minimum is caught", async () => {
    const { wallet, usdt, cake, router, guard } = await setup();
    await router.write.setCheat([1000n]); // delivers 10% less than quoted
    await reverts(guard.write.swapTokens([[usdt.address, cake.address], parseEther("10"), parseEther("19.5")], { account: wallet.account }), "ReceivedTooLittle|reverted");
  });

  it("BNB in and BNB out both pay the caller only", async () => {
    const { wallet, wbnb, usdt, cake, guard, publicClient } = await setup();
    await guard.write.swapBNBForTokens([[wbnb.address, cake.address], parseEther("1.95")], { account: wallet.account, value: parseEther("1") });
    assert.equal(await cake.read.balanceOf([wallet.account.address]), parseEther("2"));
    const before = await publicClient.getBalance({ address: wallet.account.address });
    await guard.write.swapTokensForBNB([[usdt.address, wbnb.address], parseEther("1"), parseEther("1.95")], { account: wallet.account });
    const after = await publicClient.getBalance({ address: wallet.account.address });
    assert.ok(after > before, "the wallet received the BNB (net of gas)");
  });

  it("ATTACK: a BNB path that does not start or end with WBNB is refused", async () => {
    const { wallet, usdt, cake, guard } = await setup();
    await reverts(guard.write.swapBNBForTokens([[usdt.address, cake.address], parseEther("1")], { account: wallet.account, value: parseEther("1") }), "BadPath");
    await reverts(guard.write.swapTokensForBNB([[usdt.address, cake.address], parseEther("1"), parseEther("1")], { account: wallet.account }), "BadPath");
  });

  it("holds nothing between swaps", async () => {
    const { wallet, usdt, cake, guard, publicClient } = await setup();
    await guard.write.swapTokens([[usdt.address, cake.address], parseEther("10"), parseEther("19.5")], { account: wallet.account });
    assert.equal(await usdt.read.balanceOf([guard.address]), 0n);
    assert.equal(await cake.read.balanceOf([guard.address]), 0n);
    assert.equal(await publicClient.getBalance({ address: guard.address }), 0n);
  });
});
