"use client";

/** The browser's own print dialog, which also saves as PDF - no PDF file to keep in step with the page. */
export function PrintButton() {
  return (
    <button className="paper__print" onClick={() => window.print()} type="button">
      Save as PDF
    </button>
  );
}
