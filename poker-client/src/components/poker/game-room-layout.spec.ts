import { describe, expect, it } from "vitest";
import {
  resolveCardsFlyoutDesktopLayout,
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
});
