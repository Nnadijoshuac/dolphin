"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./pearl-button.module.css";

export type PearlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  children?: ReactNode;
};

export function PearlButton({
  label,
  children,
  className = "",
  disabled,
  ...props
}: PearlButtonProps) {
  return (
    <button
      className={`${styles.pearlButton} ${className}`}
      disabled={disabled}
      {...props}
    >
      <div className={styles.wrap}>
        <p>
          {children ?? label}
        </p>
      </div>
    </button>
  );
}
