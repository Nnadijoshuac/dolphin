import styles from "@/components/dolphin-loader.module.css";

const DIGITS = ["0", "1", "0", "1", "1", "0", "0", "1"] as const;

export function DolphinLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="status">
      <div aria-hidden className={styles.matrix}>
        {DIGITS.map((digit, index) => (
          <span className={styles.digit} key={`${digit}-${index}`}>
            {digit}
          </span>
        ))}
        <span className={styles.glow} />
      </div>
      <span className="text-[0.85rem] text-muted">{label}</span>
    </div>
  );
}
