import { describe, expect, it } from "vitest";
import {
  buildEqualArcEllipsePoints,
  buildEqualPerimeterRoundedRailPoints,
} from "@/components/poker/seat-orbit-layout";
import { buildDenseMobileSeatBorderLayout } from "@/components/poker/table-board-layout";

const SYNTHETIC_FELT_WIDTH_PX = 355.56;
const SYNTHETIC_FELT_HEIGHT_PX = 496;
const SYNTHETIC_FELT_BORDER_RADIUS_X_RATIO = 0.42;
const SYNTHETIC_FELT_BORDER_RADIUS_Y_RATIO = 0.26;
const CORNER_INSET_TEST_HORIZONTAL_GAP_PX = 1;
const CORNER_INSET_TEST_VERTICAL_GAP_PX = 1;

const buildSyntheticDenseMobileSeats = ({
  count,
  width,
}: {
  count: number;
  width: number;
}) => {
  const height = Number((width / 1.26).toFixed(2));
  const points = buildEqualArcEllipsePoints({
    totalSeats: count,
    radiusX: SYNTHETIC_FELT_WIDTH_PX / 2 - width / 2 - 4,
    radiusY: SYNTHETIC_FELT_HEIGHT_PX / 2 - height / 2 - 4,
  });

  if (!points) {
    throw new Error(`Unable to build synthetic orbit points for ${count} seats`);
  }

  return points.map((point) => ({
    x: SYNTHETIC_FELT_WIDTH_PX / 2 + point.x,
    y: SYNTHETIC_FELT_HEIGHT_PX / 2 + point.y,
    width,
    height,
  }));
};

const buildSyntheticRoundedRailDenseMobileSeats = ({
  count,
  width,
  halfWidthPercent,
  halfHeightPercent,
}: {
  count: number;
  width: number;
  halfWidthPercent: number;
  halfHeightPercent: number;
}) => {
  const height = Number((width / 1.26).toFixed(2));
  const points = buildEqualPerimeterRoundedRailPoints({
    totalSeats: count,
    halfWidth: SYNTHETIC_FELT_WIDTH_PX * (halfWidthPercent / 100),
    halfHeight: SYNTHETIC_FELT_HEIGHT_PX * (halfHeightPercent / 100),
  });

  if (!points) {
    throw new Error(`Unable to build rounded-rail points for ${count} seats`);
  }

  return points.map((point) => ({
    x: SYNTHETIC_FELT_WIDTH_PX / 2 + point.x,
    y: SYNTHETIC_FELT_HEIGHT_PX / 2 + point.y,
    width,
    height,
  }));
};

const isPointInsideSyntheticRoundedRect = ({
  x,
  y,
  horizontalGapPx,
  verticalGapPx,
}: {
  x: number;
  y: number;
  horizontalGapPx: number;
  verticalGapPx: number;
}) => {
  const left = horizontalGapPx;
  const right = SYNTHETIC_FELT_WIDTH_PX - horizontalGapPx;
  const top = verticalGapPx;
  const bottom = SYNTHETIC_FELT_HEIGHT_PX - verticalGapPx;
  const radiusX = Math.max(
    0,
    Math.min((right - left) / 2, SYNTHETIC_FELT_WIDTH_PX * SYNTHETIC_FELT_BORDER_RADIUS_X_RATIO - left),
  );
  const radiusY = Math.max(
    0,
    Math.min((bottom - top) / 2, SYNTHETIC_FELT_HEIGHT_PX * SYNTHETIC_FELT_BORDER_RADIUS_Y_RATIO - top),
  );
  const innerTop = top + radiusY;
  const innerBottom = bottom - radiusY;

  if (x < left - 0.01 || x > right + 0.01 || y < top - 0.01 || y > bottom + 0.01) {
    return false;
  }

  if (x >= left + radiusX && x <= right - radiusX) {
    return true;
  }

  if (y >= innerTop && y <= innerBottom) {
    return true;
  }

  if (radiusX <= 0.01 || radiusY <= 0.01) {
    return false;
  }

  const cornerCenterX = x < left + radiusX ? left + radiusX : right - radiusX;
  const cornerCenterY = y < innerTop ? innerTop : innerBottom;
  const normalizedX = (x - cornerCenterX) / radiusX;
  const normalizedY = (y - cornerCenterY) / radiusY;

  return normalizedX ** 2 + normalizedY ** 2 <= 1.02;
};

describe("buildDenseMobileSeatBorderLayout", () => {
  it("pulls eight-handed diagonal seats toward the visible side rail", () => {
    const layout = buildDenseMobileSeatBorderLayout({
      feltWidth: 355.56,
      feltHeight: 496,
      seats: [
        { x: 177.78, y: 425.11, width: 73.25, height: 58.13 },
        { x: 71.2, y: 377.34, width: 73.25, height: 58.13 },
        { x: 40.63, y: 248.01, width: 73.25, height: 58.13 },
        { x: 71.2, y: 118.65, width: 73.25, height: 58.13 },
        { x: 177.78, y: 70.88, width: 73.25, height: 58.13 },
        { x: 284.36, y: 118.65, width: 73.25, height: 58.13 },
        { x: 314.93, y: 248.01, width: 73.25, height: 58.13 },
        { x: 284.36, y: 377.34, width: 73.25, height: 58.13 },
      ],
      horizontalGapPx: 9,
      verticalGapPx: 8,
    });

    expect(layout).not.toBeNull();
    expect(layout?.safe).toBe(true);
    expect(layout?.points[0]?.y).toBeCloseTo(458.93, 2);
    expect(layout?.points[4]?.y).toBeGreaterThan(37);
    expect(layout?.points[4]?.y).toBeLessThan(37.1);
    expect(layout?.points[1]?.y).toBeCloseTo(377.34, 2);
    expect(layout?.points[3]?.y).toBeCloseTo(118.65, 2);
    expect(layout?.points[1]?.x).toBeCloseTo(layout?.points[3]?.x ?? 0, 2);
    expect((layout?.points[1]?.x ?? 0) - 73.25 / 2).toBeGreaterThanOrEqual(8);
    expect((layout?.points[1]?.x ?? 0) - 73.25 / 2).toBeLessThanOrEqual(10);
    expect(355.56 - ((layout?.points[6]?.x ?? 0) + 73.25 / 2)).toBeGreaterThanOrEqual(8);
    expect(355.56 - ((layout?.points[6]?.x ?? 0) + 73.25 / 2)).toBeLessThanOrEqual(10);
    expect((layout?.points[4]?.y ?? 0) - 58.13 / 2).toBeGreaterThan(7.95);
    expect(496 - ((layout?.points[0]?.y ?? 0) + 58.13 / 2)).toBeGreaterThan(7.95);
  });

  it("keeps ten-handed dense mobile seats safe while tightening the top and bottom gaps", () => {
    const layout = buildDenseMobileSeatBorderLayout({
      feltWidth: 355.56,
      feltHeight: 496,
      seats: [
        { x: 177.78, y: 407.99, width: 66.45, height: 52.74 },
        { x: 84.37, y: 376.69, width: 66.45, height: 52.74 },
        { x: 42.17, y: 287.24, width: 66.45, height: 52.74 },
        { x: 42.17, y: 169.57, width: 66.45, height: 52.74 },
        { x: 84.37, y: 80.12, width: 66.45, height: 52.74 },
        { x: 177.78, y: 42.44, width: 66.45, height: 52.74 },
        { x: 271.19, y: 80.12, width: 66.45, height: 52.74 },
        { x: 313.39, y: 169.57, width: 66.45, height: 52.74 },
        { x: 313.39, y: 287.24, width: 66.45, height: 52.74 },
        { x: 271.19, y: 376.69, width: 66.45, height: 52.74 },
      ],
      horizontalGapPx: 8,
      verticalGapPx: 8,
    });

    expect(layout).not.toBeNull();
    expect(layout?.safe).toBe(true);
    expect((layout?.points[5]?.y ?? 0) - 52.74 / 2).toBeGreaterThanOrEqual(7.95);
    expect(496 - ((layout?.points[0]?.y ?? 0) + 52.74 / 2)).toBeGreaterThanOrEqual(7.95);
    expect((layout?.points[2]?.x ?? 0) - 66.45 / 2).toBeGreaterThanOrEqual(7.95);
    expect((layout?.points[2]?.x ?? 0) - 66.45 / 2).toBeLessThanOrEqual(8.05);
    expect(355.56 - ((layout?.points[7]?.x ?? 0) + 66.45 / 2)).toBeGreaterThanOrEqual(7.95);
    expect(355.56 - ((layout?.points[7]?.x ?? 0) + 66.45 / 2)).toBeLessThanOrEqual(8.05);
  });

  it("supports denser 10-15 handed mobile layouts with border spacing on both axes", () => {
    const scenarios = [
      { count: 10, width: 66.45, horizontalGapPx: 8, verticalGapPx: 8, minSideGapPx: 8, minVerticalGapPx: 8 },
      { count: 12, width: 60.04, horizontalGapPx: 7, verticalGapPx: 8, minSideGapPx: 7, minVerticalGapPx: 8 },
      { count: 13, width: 54, horizontalGapPx: 6, verticalGapPx: 7, minSideGapPx: 6, minVerticalGapPx: 7 },
      { count: 14, width: 54, horizontalGapPx: 6, verticalGapPx: 7, minSideGapPx: 6, minVerticalGapPx: 7 },
      { count: 15, width: 54, horizontalGapPx: 6, verticalGapPx: 7, minSideGapPx: 6, minVerticalGapPx: 7 },
    ] as const;

    for (const scenario of scenarios) {
      const layout = buildDenseMobileSeatBorderLayout({
        feltWidth: SYNTHETIC_FELT_WIDTH_PX,
        feltHeight: SYNTHETIC_FELT_HEIGHT_PX,
        seats: buildSyntheticDenseMobileSeats({
          count: scenario.count,
          width: scenario.width,
        }),
        horizontalGapPx: scenario.horizontalGapPx,
        verticalGapPx: scenario.verticalGapPx,
      });

      expect(layout, `${scenario.count}-handed layout should exist`).not.toBeNull();
      expect(layout?.safe, `${scenario.count}-handed layout should be safe`).toBe(true);

      const seatHeight = Number((scenario.width / 1.26).toFixed(2));
      const leftmostGap = Math.min(
        ...(layout?.points.map((point) => point.x - scenario.width / 2) ?? []),
      );
      const topGap = Math.min(
        ...(layout?.points.map((point) => point.y - seatHeight / 2) ?? []),
      );

      expect(leftmostGap, `${scenario.count}-handed left gap`).toBeGreaterThanOrEqual(
        scenario.minSideGapPx - 0.05,
      );
      expect(topGap, `${scenario.count}-handed top gap`).toBeGreaterThanOrEqual(
        scenario.minVerticalGapPx - 0.05,
      );
    }
  });

  it("keeps 13-handed corner-adjacent seat corners inside a slightly inset rounded rail", () => {
    const seatWidth = 54;
    const seatHeight = Number((seatWidth / 1.26).toFixed(2));
    const layout = buildDenseMobileSeatBorderLayout({
      feltWidth: SYNTHETIC_FELT_WIDTH_PX,
      feltHeight: SYNTHETIC_FELT_HEIGHT_PX,
      seats: buildSyntheticRoundedRailDenseMobileSeats({
        count: 13,
        width: seatWidth,
        halfWidthPercent: 41,
        halfHeightPercent: 36.9,
      }),
      horizontalGapPx: 6,
      verticalGapPx: 7,
    });

    expect(layout).not.toBeNull();
    expect(layout?.safe).toBe(true);

    const cornerSeatCornerViolations = (layout?.points ?? [])
      .map((point) => ({
        corners: [
          { x: point.x - seatWidth / 2, y: point.y - seatHeight / 2 },
          { x: point.x + seatWidth / 2, y: point.y - seatHeight / 2 },
          { x: point.x - seatWidth / 2, y: point.y + seatHeight / 2 },
          { x: point.x + seatWidth / 2, y: point.y + seatHeight / 2 },
        ],
        offsetX: Math.abs(point.x - SYNTHETIC_FELT_WIDTH_PX / 2),
        offsetY: Math.abs(point.y - SYNTHETIC_FELT_HEIGHT_PX / 2),
      }))
      .filter(
        (point) =>
          point.offsetX > SYNTHETIC_FELT_WIDTH_PX * 0.22 &&
          point.offsetY > SYNTHETIC_FELT_HEIGHT_PX * 0.24,
      )
      .map((point) =>
        point.corners.filter(
          (corner) =>
            !isPointInsideSyntheticRoundedRect({
              x: corner.x,
              y: corner.y,
              horizontalGapPx: CORNER_INSET_TEST_HORIZONTAL_GAP_PX,
              verticalGapPx: CORNER_INSET_TEST_VERTICAL_GAP_PX,
            }),
        ).length,
      );

    expect(cornerSeatCornerViolations.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...cornerSeatCornerViolations)).toBe(0);
  });

  it("keeps 13-handed rounded-rail corner seats visually closer to their neighbors", () => {
    const seatWidth = 54;
    const layout = buildDenseMobileSeatBorderLayout({
      feltWidth: SYNTHETIC_FELT_WIDTH_PX,
      feltHeight: SYNTHETIC_FELT_HEIGHT_PX,
      seats: buildSyntheticRoundedRailDenseMobileSeats({
        count: 13,
        width: seatWidth,
        halfWidthPercent: 41,
        halfHeightPercent: 36.9,
      }),
      horizontalGapPx: 6,
      verticalGapPx: 7,
    });

    expect(layout).not.toBeNull();
    expect(layout?.safe).toBe(true);

    const seatGaps = (layout?.points ?? []).map((point, index, points) => {
      const nextPoint = points[(index + 1) % points.length] ?? point;
      return Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);
    });
    const gapSpread = Math.max(...seatGaps) - Math.min(...seatGaps);

    expect(gapSpread).toBeLessThan(16);
    expect(seatGaps[0]).toBeLessThan(102);
    expect(seatGaps[12]).toBeLessThan(102);
    expect(seatGaps[1]).toBeGreaterThan(84);
    expect(seatGaps[11]).toBeGreaterThan(84);
  });
});
