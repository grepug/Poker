import { describe, expect, it } from "vitest";
import {
  MOBILE_TABLE_BOTTOM_SAFE_MIN_HEIGHT_PX,
  getBottomBarCardsOffsetPx,
  getMobileTableBottomSafeHeightPx,
} from "./mobile-overlay-layout";

describe("mobile-overlay-layout", () => {
  it("keeps the cards lane flush to the screen bottom when no bottom bar is active", () => {
    expect(getBottomBarCardsOffsetPx(0)).toBe(0);
  });

  it("adds a fixed gap above the active bottom bar", () => {
    expect(getBottomBarCardsOffsetPx(180)).toBe(196);
  });

  it("reserves enough bottom-safe height for cards and the active bottom bar", () => {
    expect(
      getMobileTableBottomSafeHeightPx({
        cardsFlyoutHeight: 118,
        bottomBarHeight: 180,
      }),
    ).toBe(338);
  });

  it("never shrinks below the baseline mobile table padding", () => {
    expect(
      getMobileTableBottomSafeHeightPx({
        cardsFlyoutHeight: 92,
        bottomBarHeight: 0,
      }),
    ).toBe(MOBILE_TABLE_BOTTOM_SAFE_MIN_HEIGHT_PX);
  });
});
