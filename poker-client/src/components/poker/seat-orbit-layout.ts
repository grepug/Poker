export type OrbitPoint = {
  x: number;
  y: number;
};

const DEFAULT_SAMPLE_COUNT = 960;
const DEFAULT_START_ANGLE = Math.PI / 2;

const buildCumulativeLengths = (points: OrbitPoint[]) => {
  const cumulativeLengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    cumulativeLengths[index] =
      cumulativeLengths[index - 1] +
      Math.hypot(currentPoint.x - previousPoint.x, currentPoint.y - previousPoint.y);
  }

  return cumulativeLengths;
};

export const buildEqualArcEllipsePoints = ({
  totalSeats,
  radiusX,
  radiusY,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  startAngle = DEFAULT_START_ANGLE,
}: {
  totalSeats: number;
  radiusX: number;
  radiusY: number;
  sampleCount?: number;
  startAngle?: number;
}): OrbitPoint[] | null => {
  if (totalSeats <= 0 || radiusX <= 0 || radiusY <= 0 || sampleCount <= 0) {
    return null;
  }

  const safeSampleCount = Math.max(180, Math.floor(sampleCount));
  const safeSeatCount = Math.floor(totalSeats);
  const sampledPoints = Array.from({ length: safeSampleCount + 1 }, (_, index) => {
    const angle = startAngle + (index / safeSampleCount) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radiusX,
      y: Math.sin(angle) * radiusY,
    };
  });

  const cumulativeLengths = buildCumulativeLengths(sampledPoints);
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;
  if (totalLength <= 0) {
    return null;
  }

  const points: OrbitPoint[] = [];
  let searchIndex = 0;

  for (let seatIndex = 0; seatIndex < safeSeatCount; seatIndex += 1) {
    const targetLength = (totalLength * seatIndex) / safeSeatCount;

    while (
      searchIndex < cumulativeLengths.length - 2 &&
      cumulativeLengths[searchIndex + 1] < targetLength
    ) {
      searchIndex += 1;
    }

    const startLength = cumulativeLengths[searchIndex] ?? 0;
    const endLength = cumulativeLengths[searchIndex + 1] ?? startLength;
    const segmentLength = endLength - startLength;
    const ratio =
      segmentLength > 0 ? (targetLength - startLength) / segmentLength : 0;
    const startPoint = sampledPoints[searchIndex];
    const endPoint = sampledPoints[searchIndex + 1] ?? startPoint;

    points.push({
      x: startPoint.x + (endPoint.x - startPoint.x) * ratio,
      y: startPoint.y + (endPoint.y - startPoint.y) * ratio,
    });
  }

  return points.length === safeSeatCount ? points : null;
};

export const buildEqualArcEllipsePercentAnchors = ({
  totalSeats,
  radiusXPercent,
  radiusYPercent,
  centerXPercent = 50,
  centerYPercent = 50,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  startAngle = DEFAULT_START_ANGLE,
}: {
  totalSeats: number;
  radiusXPercent: number;
  radiusYPercent: number;
  centerXPercent?: number;
  centerYPercent?: number;
  sampleCount?: number;
  startAngle?: number;
}) => {
  const points = buildEqualArcEllipsePoints({
    totalSeats,
    radiusX: radiusXPercent,
    radiusY: radiusYPercent,
    sampleCount,
    startAngle,
  });
  if (!points) {
    return null;
  }

  return points.map((point) => ({
    left: `${(centerXPercent + point.x).toFixed(2)}%`,
    top: `${(centerYPercent + point.y).toFixed(2)}%`,
  }));
};
