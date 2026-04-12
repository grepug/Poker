import { describe, expect, it } from "vitest";
import { shouldUseBottomPlacement } from "./use-anchored-popover";

describe("shouldUseBottomPlacement", () => {
  it("prefers the bottom placement when it fits", () => {
    expect(shouldUseBottomPlacement("bottom", true, true)).toBe(true);
    expect(shouldUseBottomPlacement("bottom", false, true)).toBe(true);
  });

  it("falls back to top when bottom is preferred but does not fit", () => {
    expect(shouldUseBottomPlacement("bottom", true, false)).toBe(false);
  });

  it("keeps top placement unless it must fall back to bottom", () => {
    expect(shouldUseBottomPlacement("top", true, true)).toBe(false);
    expect(shouldUseBottomPlacement("top", false, true)).toBe(true);
  });
});
