import { describe, expect, it } from "vitest";

import { stripToolNames } from "./answer-text";

describe("stripToolNames", () => {
  it("cleans job 56882's delivered reasons", () => {
    expect(stripToolNames("- Not a honeypot; sell tax unknown (block_token_safety).  \n")).toBe("- Not a honeypot; sell tax unknown.  \n");
  });
  it("leaves ordinary parentheses alone", () => {
    expect(stripToolNames("Top 10 hold 3.4% (burned 93.6% excluded).")).toBe("Top 10 hold 3.4% (burned 93.6% excluded).");
  });
});
