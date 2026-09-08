"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./pearl-button.module.css";

export type PearlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  children?: ReactNode;
  showSparkle?: boolean;
};

export function PearlButton({
  label,
  children,
  showSparkle = true,
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
          {showSparkle ? (
            <>
              <span aria-hidden="true">✧</span>
              <span aria-hidden="true">✦</span>
            </>
          ) : null}
          {children ?? label}
        </p>
      </div>
    </button>
  );
}
