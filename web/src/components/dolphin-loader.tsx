import styles from "@/components/dolphin-loader.module.css";

/**
 * Dolphin is working. See the module CSS for the motion and why it was
 * rescaled and recoloured from the reference.
 *
 * `label` is the honest part: this component is shown while the agent is doing
 * something specific - choosing who to ask, or waiting on a third party's
 * server - and saying which is more useful than a generic spinner. The label is
 * also what a screen reader announces, since the rings themselves are decoration.
 */
export function DolphinLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="status">
      <div aria-hidden className={styles.stage}>
        <div className={styles.ring} />
        <div className={styles.ring} />
        <div className={styles.ring} />
      </div>
      <span className="text-[0.85rem] text-muted">{label}</span>
    </div>
  );
}
