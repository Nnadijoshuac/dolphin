export const colors = {
  canvas: "#F6F4EE",
  surface: "#FFFFFF",
  ink: "#111214",
  muted: "#6E706B",
  faint: "#A5A79F",
  line: "#E6E2D8",
  gold: "#F0B90B",
  goldSoft: "#FFF1B8",
  mint: "#DCEFE4",
  mintInk: "#1C6A44",
  blue: "#DDE9F8",
  blueInk: "#295C92",
  lilac: "#E9E1F4",
  lilacInk: "#65478A",
  coral: "#F7DFD8",
  coralInk: "#964C3C",
  danger: "#B9473A",
  success: "#287A4E",
  overlay: "rgba(17, 18, 20, 0.44)",
} as const;

export const radii = {
  small: 12,
  medium: 18,
  large: 24,
  pill: 999,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 3,
  },
  floating: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 8,
  },
} as const;

