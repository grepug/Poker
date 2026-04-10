export const MOBILE_BOTTOM_BAR_GAP_PX = 16;
export const MOBILE_TABLE_BOTTOM_SAFE_MIN_HEIGHT_PX = 232;
export const MOBILE_CARDS_LANE_GAP_PX = 24;

export const getBottomBarCardsOffsetPx = (bottomBarHeight: number): number =>
  bottomBarHeight > 0 ? bottomBarHeight + MOBILE_BOTTOM_BAR_GAP_PX : 0;

export const getMobileTableBottomSafeHeightPx = ({
  cardsFlyoutHeight,
  bottomBarHeight,
}: {
  cardsFlyoutHeight: number;
  bottomBarHeight: number;
}): number =>
  Math.max(
    MOBILE_TABLE_BOTTOM_SAFE_MIN_HEIGHT_PX,
    Math.ceil(cardsFlyoutHeight) + getBottomBarCardsOffsetPx(bottomBarHeight) + MOBILE_CARDS_LANE_GAP_PX,
  );
