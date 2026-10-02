"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CategoryGlyph } from "@/components/category-glyph";
import { SET_AND_QUEST_URL } from "@/constants/site";

import styles from "./set-and-quest-link.module.css";

export function SetAndQuestLink({
  variant = "nav",
  onClick,
}: {
  variant?: "nav" | "drawer";
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(SET_AND_QUEST_URL);

  if (variant === "nav") {
    return (
      <Link
        aria-current={isActive ? "page" : undefined}
        className={`${styles.questLink} ${styles.nav}`}
        href={SET_AND_QUEST_URL}
        onClick={onClick}
      >
        <span className={styles.label}>Set and Quest</span>
        {isActive ? <span aria-hidden="true" className={styles.activeLine} /> : null}
      </Link>
    );
  }

  return (
    <Link
      className={`${styles.questLink} ${styles[variant]}`}
      href={SET_AND_QUEST_URL}
      onClick={onClick}
    >
      <span aria-hidden="true" className={styles.icon}>
        <CategoryGlyph color="currentColor" name="sparkle" size={20} strokeWidth={2} />
      </span>
      <span className={styles.copy}>
        <span className={styles.label}>Set and Quest</span>
        <span className={styles.hint}>Your campaign progress</span>
      </span>
      <CategoryGlyph color="currentColor" name="chevron-right" size={15} strokeWidth={2} />
    </Link>
  );
}
