import { describe, expect, it } from "vitest";

import { plainSkillName } from "@/components/agent-detail-extras";

describe("plainSkillName", () => {
  it("says a code-style tool name in words", () => {
    expect(plainSkillName("getVaultsWithTokens")).toBe("Get vaults with tokens");
    expect(plainSkillName("claim_rewards")).toBe("Claim rewards");
  });
  it("keeps acronyms in capitals", () => {
    expect(plainSkillName("getCLMPoolsWithChains")).toBe("Get CLM pools with chains");
  });
  it("leaves a name that is already words alone", () => {
    expect(plainSkillName("Read a Venus health factor")).toBe("Read a Venus health factor");
  });
});
