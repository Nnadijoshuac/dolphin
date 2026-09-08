import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { IdentityWalletSection } from "@/components/identity-wallet-section";
import { MobileStackHeader } from "@/components/mobile-stack-header";

export const metadata = { title: "Account | Dolphin" };

export default function AccountPage() {
  return <>
    <MobileStackHeader title="Account details" fallback="/wallet" />
    <div className="site-frame page-shell mobile-account-page">
      <AltanaWalletPanel />
      <IdentityWalletSection />
      <section id="security" className="mt-8 rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-lg font-semibold">Wallet & security details</h2>
        <dl className="mt-4 grid gap-4 text-sm"><div><dt className="text-muted">Network</dt><dd>BNB Smart Chain · 56</dd></div><div><dt className="text-muted">Private keys & seed phrases</dt><dd>Dolphin never asks you to share them.</dd></div></dl>
      </section>
    </div>
  </>;
}
