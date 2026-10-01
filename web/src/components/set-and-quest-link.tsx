"use client";

import Link from "next/link";

import { CategoryGlyph } from "@/components/category-glyph";
import { SET_AND_QUEST_URL } from "@/constants/site";

import styles from "./set-and-quest-link.module.css";

export function SetAndQuestLink({
  variant = "compact",
  onClick,
}: {
  variant?: "compact" | "drawer";
  onClick?: () => void;
}) {
  return (
    <Link
      className={`${styles.questLink} ${styles[variant]}`}
      href={SET_AND_QUEST_URL}
      onClick={onClick}
    >
      <span aria-hidden="true" className={styles.icon}>
        <CategoryGlyph color="currentColor" name="sparkle" size={variant === "compact" ? 16 : 20} strokeWidth={2} />
      </span>
      <span className={styles.copy}>
        <span className={styles.label}>Set and Quest</span>
        {variant === "drawer" ? <span className={styles.hint}>Your campaign progress</span> : null}
      </span>
      {variant === "drawer" ? (
        <CategoryGlyph color="currentColor" name="chevron-right" size={15} strokeWidth={2} />
      ) : null}
    </Link>
  );
}
