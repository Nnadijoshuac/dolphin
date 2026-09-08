"use client";

/**
 * A deterministic avatar for one address, from DiceBear's hosted API.
 * Mirrors WalletAvatar in src/components/wallet-avatar.tsx.
 */
export function WalletAvatar({
  address,
  kind,
  size = 32,
  radius,
  className = "",
}: {
  address: string;
  kind: "human" | "bot";
  size?: number;
  radius?: number;
  className?: string;
}) {
  if (!address) return null;

  const style = kind === "bot" ? "bottts-neutral" : "notionists";
  const src = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(
    address.toLowerCase(),
  )}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote SVG from DiceBear
    <img
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-cover ${className}`}
      height={size}
      src={src}
      style={{
        width: size,
        height: size,
        borderRadius: radius !== undefined ? radius : undefined,
      }}
      width={size}
    />
  );
}
