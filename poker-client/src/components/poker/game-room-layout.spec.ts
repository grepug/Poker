import { describe, expect, it } from "vitest";
import {
  resolveCardsFlyoutDesktopLayout,
  shouldUseReducedMobileSeatPerimeter,
  shouldRenderCardsFlyoutInBoardStage,
} from "./game-room-layout";

describe("game-room-layout", () => {
  it("keeps desktop flyout dock-aligned even when the turn dock is hidden", () => {
    expect(
      resolveCardsFlyoutDesktopLayout({
        shouldRenderCardsFlyout: true,
        isDesktopSideDock: true,
        showTurnActionDock: false,
      }),
    ).toEqual({
      renderInDesktopDockCluster: true,
      placement: "dock-left",
    });

    expect(
      shouldRenderCardsFlyoutInBoardStage({
        shouldRenderCardsFlyout: true,
        isDesktopSideDock: true,
        showTurnActionDock: false,
      }),
    ).toBe(false);
  });

  it("uses the board-stage flyout on non-desktop layouts", () => {
    expect(
      resolveCardsFlyoutDesktopLayout({
        shouldRenderCardsFlyout: true,
        isDesktopSideDock: false,
        showTurnActionDock: true,
      }),
    ).toEqual({
      renderInDesktopDockCluster: false,
      placement: null,
    });

    expect(
      shouldRenderCardsFlyoutInBoardStage({
        shouldRenderCardsFlyout: true,
        isDesktopSideDock: false,
        showTurnActionDock: true,
      }),
    ).toBe(true);
  });

  it("limits reduced mobile seat perimeter to dense phone-width tables", () => {
    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 355.56,
        totalSeats: 10,
      }),
    ).toBe(true);

    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 500,
        totalSeats: 10,
      }),
    ).toBe(false);

    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 355.56,
        totalSeats: 6,
      }),
    ).toBe(false);
    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 470,
        totalSeats: 2,
      }),
    ).toBe(true);

    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 390,
        totalSeats: 4,
      }),
    ).toBe(false);

    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 560,
        totalSeats: 6,
      }),
    ).toBe(true);

    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 500,
        totalSeats: 2,
      }),
    ).toBe(true);

    expect(
      shouldUseReducedMobileSeatPerimeter({
        tableWidth: 768,
        totalSeats: 2,
      }),
    ).toBe(false);
  });
});
