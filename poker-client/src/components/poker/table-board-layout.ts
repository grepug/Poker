type SeatLayoutInput = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutPoint = {
  x: number;
  y: number;
};

type DenseMobileSeatBorderLayout = {
  points: LayoutPoint[];
  safe: boolean;
};

const BORDER_TOLERANCE_PX = 0.01;
const FELT_BORDER_RADIUS_X_RATIO = 0.42;
const FELT_BORDER_RADIUS_Y_RATIO = 0.26;
const SIDE_BIAS_THRESHOLD = 0.45;
const VERTICAL_BIAS_THRESHOLD = 1.4;
const CORNER_PROJECTION_SIDE_BIAS_THRESHOLD = 0.35;
const CORNER_PROJECTION_VERTICAL_BIAS_THRESHOLD = 0.55;
const VERTICALLY_BALANCED_DENSE_MOBILE_SEAT_COUNTS = new Set([8, 10, 12, 13, 14, 15]);
const CORNER_PROJECTED_DENSE_MOBILE_SEAT_COUNT_THRESHOLD = 12;
const CORNER_CLEARANCE_DENSE_MOBILE_SEAT_COUNT_THRESHOLD = 12;
const CORNER_CLEARANCE_TARGET_INSET_PX = 1;
const CORNER_CLEARANCE_GAP_BOOST_COMBINATIONS = [
  { horizontalGapBoostPx: 1.5, verticalGapBoostPx: 1.5 },
  { horizontalGapBoostPx: 1.5, verticalGapBoostPx: 3 },
  { horizontalGapBoostPx: 3, verticalGapBoostPx: 1.5 },
  { horizontalGapBoostPx: 3, verticalGapBoostPx: 3 },
];
const CORNER_CLEARANCE_FINAL_NUDGE_PX = 1;
const CORNER_CLEARANCE_FINAL_NUDGE_STEPS = 3;

const rectanglesOverlap = (
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number },
) =>
  Math.min(first.right, second.right) - Math.max(first.left, second.left) > BORDER_TOLERANCE_PX &&
  Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > BORDER_TOLERANCE_PX;

const getRoundedRectInsetMetrics = ({
  feltWidth,
  feltHeight,
  seatWidth,
  seatHeight,
  horizontalGapPx,
  verticalGapPx,
}: {
  feltWidth: number;
  feltHeight: number;
  seatWidth: number;
  seatHeight: number;
  horizontalGapPx: number;
  verticalGapPx: number;
}) => {
  const left = horizontalGapPx + seatWidth / 2;
  const right = feltWidth - horizontalGapPx - seatWidth / 2;
  const top = verticalGapPx + seatHeight / 2;
  const bottom = feltHeight - verticalGapPx - seatHeight / 2;
  const radiusX = Math.max(
    0,
    Math.min((right - left) / 2, feltWidth * FELT_BORDER_RADIUS_X_RATIO - left),
  );
  const radiusY = Math.max(
    0,
    Math.min((bottom - top) / 2, feltHeight * FELT_BORDER_RADIUS_Y_RATIO - top),
  );

  return {
    left,
    right,
    top,
    bottom,
    radiusX,
    radiusY,
    innerTop: top + radiusY,
    innerBottom: bottom - radiusY,
  };
};

const resolveRoundedRectBoundaryX = ({
  feltWidth,
  feltHeight,
  seatWidth,
  seatHeight,
  horizontalGapPx,
  verticalGapPx,
  y,
  side,
}: {
  feltWidth: number;
  feltHeight: number;
  seatWidth: number;
  seatHeight: number;
  horizontalGapPx: number;
  verticalGapPx: number;
  y: number;
  side: "left" | "right";
}) => {
  const metrics = getRoundedRectInsetMetrics({
    feltWidth,
    feltHeight,
    seatWidth,
    seatHeight,
    horizontalGapPx,
    verticalGapPx,
  });

  if (
    metrics.radiusX <= BORDER_TOLERANCE_PX ||
    metrics.radiusY <= BORDER_TOLERANCE_PX
  ) {
    return side === "left" ? metrics.left : metrics.right;
  }

  if (y >= metrics.innerTop && y <= metrics.innerBottom) {
    return side === "left" ? metrics.left : metrics.right;
  }

  const cornerCenterY = y < metrics.innerTop ? metrics.innerTop : metrics.innerBottom;
  const cornerCenterX =
    side === "left" ? metrics.left + metrics.radiusX : metrics.right - metrics.radiusX;
  const normalizedY = (y - cornerCenterY) / metrics.radiusY;
  const normalizedX = metrics.radiusX * Math.sqrt(Math.max(0, 1 - normalizedY ** 2));

  return side === "left"
    ? cornerCenterX - normalizedX
    : cornerCenterX + normalizedX;
};

const resolveRoundedRectBoundaryY = ({
  feltWidth,
  feltHeight,
  seatWidth,
  seatHeight,
  horizontalGapPx,
  verticalGapPx,
  x,
  side,
}: {
  feltWidth: number;
  feltHeight: number;
  seatWidth: number;
  seatHeight: number;
  horizontalGapPx: number;
  verticalGapPx: number;
  x: number;
  side: "top" | "bottom";
}) => {
  const metrics = getRoundedRectInsetMetrics({
    feltWidth,
    feltHeight,
    seatWidth,
    seatHeight,
    horizontalGapPx,
    verticalGapPx,
  });

  if (
    metrics.radiusX <= BORDER_TOLERANCE_PX ||
    metrics.radiusY <= BORDER_TOLERANCE_PX
  ) {
    return side === "top" ? metrics.top : metrics.bottom;
  }

  const innerLeft = metrics.left + metrics.radiusX;
  const innerRight = metrics.right - metrics.radiusX;
  if (x >= innerLeft && x <= innerRight) {
    return side === "top" ? metrics.top : metrics.bottom;
  }

  const cornerCenterX = x < innerLeft ? innerLeft : innerRight;
  const cornerCenterY =
    side === "top" ? metrics.top + metrics.radiusY : metrics.bottom - metrics.radiusY;
  const normalizedX = (x - cornerCenterX) / metrics.radiusX;
  const normalizedY = metrics.radiusY * Math.sqrt(Math.max(0, 1 - normalizedX ** 2));

  return side === "top"
    ? cornerCenterY - normalizedY
    : cornerCenterY + normalizedY;
};

const resolveRoundedRectBoundaryPointOnRay = ({
  feltWidth,
  feltHeight,
  seatWidth,
  seatHeight,
  horizontalGapPx,
  verticalGapPx,
  fromX,
  fromY,
  towardX,
  towardY,
}: {
  feltWidth: number;
  feltHeight: number;
  seatWidth: number;
  seatHeight: number;
  horizontalGapPx: number;
  verticalGapPx: number;
  fromX: number;
  fromY: number;
  towardX: number;
  towardY: number;
}) => {
  const deltaX = towardX - fromX;
  const deltaY = towardY - fromY;

  if (
    Math.abs(deltaX) <= BORDER_TOLERANCE_PX &&
    Math.abs(deltaY) <= BORDER_TOLERANCE_PX
  ) {
    return { x: towardX, y: towardY };
  }

  const isScaleInside = (scale: number) =>
    isSeatCenterInsideRoundedRect({
      feltWidth,
      feltHeight,
      x: fromX + deltaX * scale,
      y: fromY + deltaY * scale,
      seatWidth,
      seatHeight,
      horizontalGapPx,
      verticalGapPx,
    });

  let lowScale = 0;
  let highScale = 1;
  while (highScale < 4 && isScaleInside(highScale)) {
    lowScale = highScale;
    highScale *= 1.35;
  }

  if (isScaleInside(highScale)) {
    return {
      x: fromX + deltaX * highScale,
      y: fromY + deltaY * highScale,
    };
  }

  for (let step = 0; step < 20; step += 1) {
    const midScale = (lowScale + highScale) / 2;
    if (isScaleInside(midScale)) {
      lowScale = midScale;
    } else {
      highScale = midScale;
    }
  }

  return {
    x: fromX + deltaX * lowScale,
    y: fromY + deltaY * lowScale,
  };
};

const isSeatCenterInsideRoundedRect = ({
  feltWidth,
  feltHeight,
  x,
  y,
  seatWidth,
  seatHeight,
  horizontalGapPx,
  verticalGapPx,
}: {
  feltWidth: number;
  feltHeight: number;
  x: number;
  y: number;
  seatWidth: number;
  seatHeight: number;
  horizontalGapPx: number;
  verticalGapPx: number;
}) => {
  const metrics = getRoundedRectInsetMetrics({
    feltWidth,
    feltHeight,
    seatWidth,
    seatHeight,
    horizontalGapPx,
    verticalGapPx,
  });

  if (
    x < metrics.left - BORDER_TOLERANCE_PX ||
    x > metrics.right + BORDER_TOLERANCE_PX ||
    y < metrics.top - BORDER_TOLERANCE_PX ||
    y > metrics.bottom + BORDER_TOLERANCE_PX
  ) {
    return false;
  }

  if (x >= metrics.left + metrics.radiusX && x <= metrics.right - metrics.radiusX) {
    return true;
  }

  if (y >= metrics.innerTop && y <= metrics.innerBottom) {
    return true;
  }

  if (
    metrics.radiusX <= BORDER_TOLERANCE_PX ||
    metrics.radiusY <= BORDER_TOLERANCE_PX
  ) {
    return false;
  }

  const cornerCenterX =
    x < metrics.left + metrics.radiusX
      ? metrics.left + metrics.radiusX
      : metrics.right - metrics.radiusX;
  const cornerCenterY =
    y < metrics.innerTop ? metrics.innerTop : metrics.innerBottom;
  const normalizedX = (x - cornerCenterX) / metrics.radiusX;
  const normalizedY = (y - cornerCenterY) / metrics.radiusY;
  return normalizedX ** 2 + normalizedY ** 2 <= 1 + 0.02;
};

const isPointInsideRoundedRect = ({
  feltWidth,
  feltHeight,
  x,
  y,
  horizontalGapPx,
  verticalGapPx,
}: {
  feltWidth: number;
  feltHeight: number;
  x: number;
  y: number;
  horizontalGapPx: number;
  verticalGapPx: number;
}) => {
  const metrics = getRoundedRectInsetMetrics({
    feltWidth,
    feltHeight,
    seatWidth: 0,
    seatHeight: 0,
    horizontalGapPx,
    verticalGapPx,
  });

  if (
    x < metrics.left - BORDER_TOLERANCE_PX ||
    x > metrics.right + BORDER_TOLERANCE_PX ||
    y < metrics.top - BORDER_TOLERANCE_PX ||
    y > metrics.bottom + BORDER_TOLERANCE_PX
  ) {
    return false;
  }

  if (x >= metrics.left + metrics.radiusX && x <= metrics.right - metrics.radiusX) {
    return true;
  }

  if (y >= metrics.innerTop && y <= metrics.innerBottom) {
    return true;
  }

  if (
    metrics.radiusX <= BORDER_TOLERANCE_PX ||
    metrics.radiusY <= BORDER_TOLERANCE_PX
  ) {
    return false;
  }

  const cornerCenterX =
    x < metrics.left + metrics.radiusX
      ? metrics.left + metrics.radiusX
      : metrics.right - metrics.radiusX;
  const cornerCenterY =
    y < metrics.innerTop ? metrics.innerTop : metrics.innerBottom;
  const normalizedX = (x - cornerCenterX) / metrics.radiusX;
  const normalizedY = (y - cornerCenterY) / metrics.radiusY;
  return normalizedX ** 2 + normalizedY ** 2 <= 1 + 0.02;
};

const getSeatCornersOutsideRoundedRect = ({
  feltWidth,
  feltHeight,
  seat,
  point,
  horizontalGapPx,
  verticalGapPx,
}: {
  feltWidth: number;
  feltHeight: number;
  seat: SeatLayoutInput;
  point: LayoutPoint;
  horizontalGapPx: number;
  verticalGapPx: number;
}) =>
  [
    { x: point.x - seat.width / 2, y: point.y - seat.height / 2 },
    { x: point.x + seat.width / 2, y: point.y - seat.height / 2 },
    { x: point.x - seat.width / 2, y: point.y + seat.height / 2 },
    { x: point.x + seat.width / 2, y: point.y + seat.height / 2 },
  ].filter(
    (corner) =>
      !isPointInsideRoundedRect({
        feltWidth,
        feltHeight,
        x: corner.x,
        y: corner.y,
        horizontalGapPx,
        verticalGapPx,
      }),
  );

export const buildDenseMobileSeatBorderLayout = ({
  feltWidth,
  feltHeight,
  seats,
  horizontalGapPx,
  verticalGapPx,
}: {
  feltWidth: number;
  feltHeight: number;
  seats: SeatLayoutInput[];
  horizontalGapPx: number;
  verticalGapPx: number;
}): DenseMobileSeatBorderLayout | null => {
  if (
    feltWidth <= 0 ||
    feltHeight <= 0 ||
    seats.length === 0 ||
    horizontalGapPx < 0 ||
    verticalGapPx < 0
  ) {
    return null;
  }

  const centerX = feltWidth / 2;
  const centerY = feltHeight / 2;
  const useDenseMobileVerticalBalancing =
    VERTICALLY_BALANCED_DENSE_MOBILE_SEAT_COUNTS.has(seats.length);
  const resolveSeatTargetPoint = ({
    seat,
    resolvedHorizontalGapPx,
    resolvedVerticalGapPx,
  }: {
    seat: SeatLayoutInput;
    resolvedHorizontalGapPx: number;
    resolvedVerticalGapPx: number;
  }) => {
    const offsetX = seat.x - centerX;
    const offsetY = seat.y - centerY;
    const isSideBiased = Math.abs(offsetX) >= Math.abs(offsetY) * SIDE_BIAS_THRESHOLD;
    const isVerticalBiased =
      useDenseMobileVerticalBalancing &&
      Math.abs(offsetY) > Math.abs(offsetX) * VERTICAL_BIAS_THRESHOLD;
    const isCornerProjectionCandidate =
      seats.length >= CORNER_PROJECTED_DENSE_MOBILE_SEAT_COUNT_THRESHOLD &&
      useDenseMobileVerticalBalancing &&
      Math.abs(offsetX) >= Math.abs(offsetY) * CORNER_PROJECTION_SIDE_BIAS_THRESHOLD &&
      Math.abs(offsetY) >= Math.abs(offsetX) * CORNER_PROJECTION_VERTICAL_BIAS_THRESHOLD;
    let targetX = seat.x;
    let targetY = seat.y;

    if (isCornerProjectionCandidate) {
      return resolveRoundedRectBoundaryPointOnRay({
        feltWidth,
        feltHeight,
        seatWidth: seat.width,
        seatHeight: seat.height,
        horizontalGapPx: resolvedHorizontalGapPx,
        verticalGapPx: resolvedVerticalGapPx,
        fromX: centerX,
        fromY: centerY,
        towardX: seat.x,
        towardY: seat.y,
      });
    }

    if (isSideBiased) {
      targetX = resolveRoundedRectBoundaryX({
        feltWidth,
        feltHeight,
        seatWidth: seat.width,
        seatHeight: seat.height,
        horizontalGapPx: resolvedHorizontalGapPx,
        verticalGapPx: resolvedVerticalGapPx,
        y: seat.y,
        side: offsetX < 0 ? "left" : "right",
      });
    }

    if (isVerticalBiased) {
      targetY = resolveRoundedRectBoundaryY({
        feltWidth,
        feltHeight,
        seatWidth: seat.width,
        seatHeight: seat.height,
        horizontalGapPx: resolvedHorizontalGapPx,
        verticalGapPx: resolvedVerticalGapPx,
        x: targetX,
        side: offsetY < 0 ? "top" : "bottom",
      });
    }

    return {
      x: targetX,
      y: targetY,
    };
  };

  const points = seats.map((seat) => {
    const basePoint = resolveSeatTargetPoint({
      seat,
      resolvedHorizontalGapPx: horizontalGapPx,
      resolvedVerticalGapPx: verticalGapPx,
    });

    if (seats.length < CORNER_CLEARANCE_DENSE_MOBILE_SEAT_COUNT_THRESHOLD) {
      return basePoint;
    }

    if (
      getSeatCornersOutsideRoundedRect({
        feltWidth,
        feltHeight,
        seat,
        point: basePoint,
        horizontalGapPx: horizontalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
        verticalGapPx: verticalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
      }).length === 0
    ) {
      return basePoint;
    }

    let clearancePoint = basePoint;
    for (const gapBoost of CORNER_CLEARANCE_GAP_BOOST_COMBINATIONS) {
      clearancePoint = resolveSeatTargetPoint({
        seat,
        resolvedHorizontalGapPx: horizontalGapPx + gapBoost.horizontalGapBoostPx,
        resolvedVerticalGapPx: verticalGapPx + gapBoost.verticalGapBoostPx,
      });

      if (
        getSeatCornersOutsideRoundedRect({
          feltWidth,
          feltHeight,
          seat,
          point: clearancePoint,
          horizontalGapPx: horizontalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
          verticalGapPx: verticalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
        }).length === 0
      ) {
        return clearancePoint;
      }
    }

    let nudgedPoint = clearancePoint;
    for (let step = 0; step < CORNER_CLEARANCE_FINAL_NUDGE_STEPS; step += 1) {
      const badCorners = getSeatCornersOutsideRoundedRect({
        feltWidth,
        feltHeight,
        seat,
        point: nudgedPoint,
        horizontalGapPx: horizontalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
        verticalGapPx: verticalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
      });
      if (badCorners.length === 0) {
        return nudgedPoint;
      }

      const nextPoint = {
        x:
          nudgedPoint.x +
          (badCorners.some((corner) => corner.x < centerX)
            ? CORNER_CLEARANCE_FINAL_NUDGE_PX
            : 0) -
          (badCorners.some((corner) => corner.x > centerX)
            ? CORNER_CLEARANCE_FINAL_NUDGE_PX
            : 0),
        y:
          nudgedPoint.y +
          (badCorners.some((corner) => corner.y < centerY)
            ? CORNER_CLEARANCE_FINAL_NUDGE_PX
            : 0) -
          (badCorners.some((corner) => corner.y > centerY)
            ? CORNER_CLEARANCE_FINAL_NUDGE_PX
            : 0),
      };

      if (
        !isSeatCenterInsideRoundedRect({
          feltWidth,
          feltHeight,
          x: nextPoint.x,
          y: nextPoint.y,
          seatWidth: seat.width,
          seatHeight: seat.height,
          horizontalGapPx,
          verticalGapPx,
        })
      ) {
        break;
      }

      nudgedPoint = nextPoint;
    }

    if (
      getSeatCornersOutsideRoundedRect({
        feltWidth,
        feltHeight,
        seat,
        point: nudgedPoint,
        horizontalGapPx: horizontalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
        verticalGapPx: verticalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
      }).length === 0
    ) {
      return nudgedPoint;
    }

    return clearancePoint;
  });

  const resolvedPoints =
    seats.length < CORNER_CLEARANCE_DENSE_MOBILE_SEAT_COUNT_THRESHOLD
      ? points
      : points.map((point, index) => {
          let nudgedPoint = point;

          for (let step = 0; step < CORNER_CLEARANCE_FINAL_NUDGE_STEPS; step += 1) {
            const badCorners = getSeatCornersOutsideRoundedRect({
              feltWidth,
              feltHeight,
              seat: seats[index],
              point: nudgedPoint,
              horizontalGapPx: horizontalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
              verticalGapPx: verticalGapPx + CORNER_CLEARANCE_TARGET_INSET_PX,
            });
            if (badCorners.length === 0) {
              return nudgedPoint;
            }

            const nextPoint = {
              x:
                nudgedPoint.x +
                (badCorners.some((corner) => corner.x < centerX)
                  ? CORNER_CLEARANCE_FINAL_NUDGE_PX
                  : 0) -
                (badCorners.some((corner) => corner.x > centerX)
                  ? CORNER_CLEARANCE_FINAL_NUDGE_PX
                  : 0),
              y:
                nudgedPoint.y +
                (badCorners.some((corner) => corner.y < centerY)
                  ? CORNER_CLEARANCE_FINAL_NUDGE_PX
                  : 0) -
                (badCorners.some((corner) => corner.y > centerY)
                  ? CORNER_CLEARANCE_FINAL_NUDGE_PX
                  : 0),
            };

            if (
              !isSeatCenterInsideRoundedRect({
                feltWidth,
                feltHeight,
                x: nextPoint.x,
                y: nextPoint.y,
                seatWidth: seats[index].width,
                seatHeight: seats[index].height,
                horizontalGapPx,
                verticalGapPx,
              })
            ) {
              break;
            }

            nudgedPoint = nextPoint;
          }

          return nudgedPoint;
        });

  const safe = resolvedPoints.every((point, index) =>
    isSeatCenterInsideRoundedRect({
      feltWidth,
      feltHeight,
      x: point.x,
      y: point.y,
      seatWidth: seats[index].width,
      seatHeight: seats[index].height,
      horizontalGapPx,
      verticalGapPx,
    }),
  ) &&
    resolvedPoints
      .map((point, index) => ({
        left: point.x - seats[index].width / 2,
        right: point.x + seats[index].width / 2,
        top: point.y - seats[index].height / 2,
        bottom: point.y + seats[index].height / 2,
      }))
      .every((rect, index, rects) =>
        rects.slice(index + 1).every((otherRect) => !rectanglesOverlap(rect, otherRect)),
      );

  return {
    points: resolvedPoints,
    safe,
  };
};
