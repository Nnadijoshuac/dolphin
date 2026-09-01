import { Image } from "expo-image";

import { colors } from "@/constants/theme";

/**
 * A deterministic avatar for one address, from DiceBear's hosted API.
 *
 * MIRRORED BY HAND from WalletAvatar in web/src/components/altana-wallet-panel.tsx.
 * Same two styles, same seeding rule, so one wallet renders the same face on
 * both products. Edit both in one change.
 *
 * Two styles, so the two accounts are distinguishable at a glance rather than
 * only by reading their labels: a drawn human face for the address the person
 * owns, a robot for the account that acts on their behalf. The seed is the
 * address, so a given wallet always renders the same face on every device.
 *
 * No npm dependency is added - it is a URL, served over HTTP and rendered by
 * expo-image like any other remote image. That deliberately keeps this out of
 * the native bundle-size and SDK-compatibility questions that govern the
 * Altana packages.
 *
 * Decorative: the address itself is shown beside it, so this carries no
 * information a screen reader needs and is hidden from the accessibility tree.
 */
export function WalletAvatar({
  address,
  kind,
  size = 26,
}: {
  address: string;
  kind: "human" | "bot";
  size?: number;
}) {
  // An empty address would seed every wallet the same face, which is worse
  // than none at all - it would imply two different accounts are one.
  if (!address) return null;

  const style = kind === "bot" ? "bottts-neutral" : "notionists";
  const uri = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(
    address.toLowerCase(),
  )}`;

  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      source={{ uri }}
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        backgroundColor: colors.surfaceSubtle,
        borderWidth: 1,
        borderColor: colors.line,
      }}
      transition={120}
    />
  );
}
