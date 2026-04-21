type ResolveCardsFlyoutDesktopLayoutArgs = {
  shouldRenderCardsFlyout: boolean;
  isDesktopSideDock: boolean;
  showTurnActionDock: boolean;
};

type ReducedMobileSeatPerimeterArgs = {
  tableWidth: number;
  totalSeats: number;
};

const DENSE_MOBILE_SEAT_PERIMETER_MAX_WIDTH_PX = 430;
const DENSE_MOBILE_SEAT_PERIMETER_MIN_SEAT_COUNT = 8;
const LOW_SEAT_MID_MOBILE_SEAT_PERIMETER_MAX_WIDTH_PX = 560;
const LOW_SEAT_MID_MOBILE_SEAT_PERIMETER_MIN_WIDTH_PX = 430;
const LOW_SEAT_MID_MOBILE_SEAT_PERIMETER_MAX_SEAT_COUNT = 6;

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

export const shouldUseReducedMobileSeatPerimeter = ({
  tableWidth,
  totalSeats,
}: ReducedMobileSeatPerimeterArgs): boolean =>
  tableWidth > 0 &&
  ((totalSeats >= DENSE_MOBILE_SEAT_PERIMETER_MIN_SEAT_COUNT &&
    tableWidth <= DENSE_MOBILE_SEAT_PERIMETER_MAX_WIDTH_PX) ||
    (totalSeats <= LOW_SEAT_MID_MOBILE_SEAT_PERIMETER_MAX_SEAT_COUNT &&
      tableWidth > LOW_SEAT_MID_MOBILE_SEAT_PERIMETER_MIN_WIDTH_PX &&
      tableWidth <= LOW_SEAT_MID_MOBILE_SEAT_PERIMETER_MAX_WIDTH_PX));
