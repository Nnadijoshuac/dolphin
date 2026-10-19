"use client";

/**
 * The change chip from shadcn-fintech's crypto dashboard (MIT, (c) 2026 Abderrahim Ghazali,
 * github.com/abderrahimghazali/shadcn-fintech). The owner (2026-10-19) kept our own layout and took the
 * template's type and icons: a trend arrow on a tinted pill wherever a change is shown.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** The change chip: a trend arrow and the % on a tinted pill. */
export function TChange({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-xs font-medium text-[#a1a1a1]">—</span>;
  const up = value >= 0;
  return (
    <span className={cx("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", up ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
      <svg aria-hidden className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        {up ? <path d="M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6" /> : <path d="M22 17 13.5 8.5 8.5 13.5 2 7M16 17h6v-6" />}
      </svg>
      {up ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}
