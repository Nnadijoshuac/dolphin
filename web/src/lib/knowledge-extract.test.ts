import { describe, expect, it } from "vitest";

import { pdfLinesToMarkdown, sniffKind } from "./knowledge-extract";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("sniffKind", () => {
  it("judges a file by its bytes, not its name", () => {
    expect(sniffKind(bytes("%PDF-1.7\n..."), "guide.txt")).toBe("pdf");
    expect(sniffKind(bytes("# Styles\n"), "styles.md")).toBe("markdown");
    expect(sniffKind(bytes("plain words"), "notes.txt")).toBe("text");
    // A renamed script is only text: accepted as text, never run.
    expect(sniffKind(bytes("console.log('hi')"), "evil.md")).toBe("markdown");
    // A binary (an .exe starts "MZ" and has NUL bytes) is refused whatever it is called.
    expect(sniffKind(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), "styles.md")).toBeNull();
    expect(sniffKind(new Uint8Array([0xff, 0xfe, 0xfd]), "x.txt")).toBeNull();
  });
});

describe("pdfLinesToMarkdown", () => {
  it("turns a PDF's font sizes into headings", () => {
    // The sizes the 2026-10-03 printed test PDF really had: 24pt title, 18pt headings, 12pt body.
    const md = pdfLinesToMarkdown([
      { text: "Motion Graphics Style Guide", size: 24 },
      { text: "How to cut three styles of motion graphics. Each section is self-contained.", size: 12 },
      { text: "Apple Style", size: 18 },
      { text: "Slow push-ins, soft gradients, white space. Type enters with a 400 ms ease-out.", size: 12 },
      { text: "Showreel", size: 18 },
      { text: "Fast montage at 120 BPM. Cut on the beat; hold hero shots for two bars.", size: 12 },
    ]);
    expect(md).toMatch(/^# Motion Graphics Style Guide$/m);
    expect(md).toMatch(/^## Apple Style$/m);
    expect(md).toMatch(/^## Showreel$/m);
  });

  it("keeps a paragraph in a big font as a paragraph", () => {
    const long = "A".repeat(150);
    const md = pdfLinesToMarkdown([
      { text: long, size: 20 },
      { text: "body ".repeat(60), size: 12 },
    ]);
    expect(md.startsWith("#")).toBe(false);
  });
});
