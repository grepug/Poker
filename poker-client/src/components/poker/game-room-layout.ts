type ResolveCardsFlyoutDesktopLayoutArgs = {
  shouldRenderCardsFlyout: boolean;
  isDesktopSideDock: boolean;
  showTurnActionDock: boolean;
};

export const resolveCardsFlyoutDesktopLayout = ({
  shouldRenderCardsFlyout,
  isDesktopSideDock,
}: ResolveCardsFlyoutDesktopLayoutArgs): {
  renderInDesktopDockCluster: boolean;
  placement: "dock-left" | null;
} => {
  if (!shouldRenderCardsFlyout || !isDesktopSideDock) {
    return {
      renderInDesktopDockCluster: false,
      placement: null,
    };
  }

  return {
    renderInDesktopDockCluster: true,
    placement: "dock-left",
  };
};

export const shouldRenderCardsFlyoutInBoardStage = ({
  shouldRenderCardsFlyout,
  isDesktopSideDock,
}: ResolveCardsFlyoutDesktopLayoutArgs): boolean =>
  shouldRenderCardsFlyout && !isDesktopSideDock;
