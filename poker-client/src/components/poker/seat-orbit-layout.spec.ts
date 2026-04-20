import { describe, expect, it } from "vitest";
import {
  buildEqualPerimeterRoundedRailPoints,
  buildEqualPerimeterRoundedRailPercentAnchors,
  buildEqualPerimeterRoundedRailPercentAnchorsForFrame,
} from "@/components/poker/seat-orbit-layout";

const distanceBetween = (
  first: { x: number; y: number },
  second: { x: number; y: number },
) => Math.hypot(first.x - second.x, first.y - second.y);

describe("buildEqualPerimeterRoundedRailPoints", () => {
  it("pushes corner-adjacent dense seats outward while keeping the orbit symmetric", () => {
    const roundedRailPoints = buildEqualPerimeterRoundedRailPoints({
      totalSeats: 13,
      halfWidth: 41,
      halfHeight: 36.9,
    });

    expect(roundedRailPoints).not.toBeNull();

    const topGap = distanceBetween(
      roundedRailPoints?.[6] ?? { x: 0, y: 0 },
      roundedRailPoints?.[7] ?? { x: 0, y: 0 },
    );
    const leftCornerGap = distanceBetween(
      roundedRailPoints?.[5] ?? { x: 0, y: 0 },
      roundedRailPoints?.[6] ?? { x: 0, y: 0 },
    );
    const sideGap = distanceBetween(
      roundedRailPoints?.[3] ?? { x: 0, y: 0 },
      roundedRailPoints?.[4] ?? { x: 0, y: 0 },
    );

    expect(Math.abs((roundedRailPoints?.[0]?.x ?? 1))).toBeLessThan(0.01);
    expect((roundedRailPoints?.[0]?.y ?? 0)).toBeGreaterThan(36.8);
    expect(Math.abs((roundedRailPoints?.[5]?.x ?? 0))).toBeGreaterThan(33);
    expect(Math.abs((roundedRailPoints?.[8]?.x ?? 0))).toBeGreaterThan(33);
    expect(topGap).toBeGreaterThan(22);
    expect(leftCornerGap).toBeGreaterThan(22);
    expect(sideGap).toBeGreaterThan(22);
    expect(
      Math.abs((roundedRailPoints?.[6]?.x ?? 0) + (roundedRailPoints?.[7]?.x ?? 0)),
    ).toBeLessThan(0.01);
    expect(
      Math.abs((roundedRailPoints?.[3]?.x ?? 0) + (roundedRailPoints?.[10]?.x ?? 0)),
    ).toBeLessThan(0.3);
    expect(
      Math.abs((roundedRailPoints?.[3]?.y ?? 0) - (roundedRailPoints?.[10]?.y ?? 0)),
    ).toBeLessThan(0.01);
  });
});

describe("buildEqualPerimeterRoundedRailPercentAnchorsForFrame", () => {
  it("keeps dense mobile rail anchors more even after a non-square felt scales them", () => {
    const feltWidthPx = 355.56;
    const feltHeightPx = 496;
    const legacyAnchors = buildEqualPerimeterRoundedRailPercentAnchors({
      totalSeats: 13,
      halfWidthPercent: 41,
      halfHeightPercent: 36.9,
      centerYPercent: 50,
    });
    const frameAwareAnchors = buildEqualPerimeterRoundedRailPercentAnchorsForFrame({
      totalSeats: 13,
      feltWidthPx,
      feltHeightPx,
      halfWidthPercent: 41,
      halfHeightPercent: 36.9,
      centerYPercent: 50,
    });

    expect(legacyAnchors).not.toBeNull();
    expect(frameAwareAnchors).not.toBeNull();

    const toPixelPoints = (anchors: Array<{ left: string; top: string }>) =>
      anchors.map((anchor) => ({
        x: (Number.parseFloat(anchor.left) / 100) * feltWidthPx,
        y: (Number.parseFloat(anchor.top) / 100) * feltHeightPx,
      }));

    const buildGapSpread = (points: Array<{ x: number; y: number }>) => {
      const gaps = points.map((point, index) =>
        distanceBetween(point, points[(index + 1) % points.length] ?? point),
      );
      return Math.max(...gaps) - Math.min(...gaps);
    };

    const legacyGapSpread = buildGapSpread(toPixelPoints(legacyAnchors ?? []));
    const frameAwareGapSpread = buildGapSpread(
      toPixelPoints(frameAwareAnchors ?? []),
    );

    expect(frameAwareGapSpread).toBeLessThan(legacyGapSpread - 15);
    expect(frameAwareGapSpread).toBeLessThan(12);
  });
});
