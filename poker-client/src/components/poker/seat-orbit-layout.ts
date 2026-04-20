type OrbitPoint = {
  x: number;
  y: number;
};

const DEFAULT_SAMPLE_COUNT = 960;
const DEFAULT_START_ANGLE = Math.PI / 2;
const DEFAULT_VISUAL_BALANCE_ORIENTATION_WEIGHT = 0.45;
const DEFAULT_VISUAL_BALANCE_ORIENTATION_EXPONENT = 1.4;
const DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_X_RATIO = 0.34;
const DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_Y_RATIO = 0.3;

const buildCumulativeLengths = (
  points: OrbitPoint[],
  resolveSegmentWeight: (segment: {
    startPoint: OrbitPoint;
    endPoint: OrbitPoint;
    midpoint: OrbitPoint;
    dx: number;
    dy: number;
    length: number;
  }) => number = () => 1,
) => {
  const cumulativeLengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    const dx = currentPoint.x - previousPoint.x;
    const dy = currentPoint.y - previousPoint.y;
    const length = Math.hypot(dx, dy);
    cumulativeLengths[index] =
      cumulativeLengths[index - 1] +
      length *
        resolveSegmentWeight({
          startPoint: previousPoint,
          endPoint: currentPoint,
          midpoint: {
            x: (previousPoint.x + currentPoint.x) / 2,
            y: (previousPoint.y + currentPoint.y) / 2,
          },
          dx,
          dy,
          length,
        });
  }

  return cumulativeLengths;
};

const buildSampledEllipsePoints = ({
  radiusX,
  radiusY,
  sampleCount,
  startAngle,
}: {
  radiusX: number;
  radiusY: number;
  sampleCount: number;
  startAngle: number;
}) =>
  Array.from({ length: sampleCount + 1 }, (_, index) => {
    const angle = startAngle + (index / sampleCount) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radiusX,
      y: Math.sin(angle) * radiusY,
    };
  });

const buildSampledRoundedRailPoints = ({
  halfWidth,
  halfHeight,
  cornerRadiusX,
  cornerRadiusY,
  straightSampleCount,
  arcSampleCount,
}: {
  halfWidth: number;
  halfHeight: number;
  cornerRadiusX: number;
  cornerRadiusY: number;
  straightSampleCount: number;
  arcSampleCount: number;
}) => {
  const innerHalfWidth = Math.max(0, halfWidth - cornerRadiusX);
  const innerHalfHeight = Math.max(0, halfHeight - cornerRadiusY);
  const points: OrbitPoint[] = [];
  const appendPoint = (point: OrbitPoint) => {
    points.push(point);
  };

  for (let index = 0; index <= straightSampleCount; index += 1) {
    const progress = index / straightSampleCount;
    appendPoint({
      x: -innerHalfWidth * progress,
      y: halfHeight,
    });
  }

  for (let index = 1; index <= arcSampleCount; index += 1) {
    const angle = Math.PI / 2 + (index / arcSampleCount) * (Math.PI / 2);
    appendPoint({
      x: -innerHalfWidth + Math.cos(angle) * cornerRadiusX,
      y: innerHalfHeight + Math.sin(angle) * cornerRadiusY,
    });
  }

  for (let index = 1; index <= straightSampleCount; index += 1) {
    const progress = index / straightSampleCount;
    appendPoint({
      x: -halfWidth,
      y: innerHalfHeight - progress * innerHalfHeight * 2,
    });
  }

  for (let index = 1; index <= arcSampleCount; index += 1) {
    const angle = Math.PI + (index / arcSampleCount) * (Math.PI / 2);
    appendPoint({
      x: -innerHalfWidth + Math.cos(angle) * cornerRadiusX,
      y: -innerHalfHeight + Math.sin(angle) * cornerRadiusY,
    });
  }

  for (let index = 1; index <= straightSampleCount * 2; index += 1) {
    const progress = index / (straightSampleCount * 2);
    appendPoint({
      x: -innerHalfWidth + progress * innerHalfWidth * 2,
      y: -halfHeight,
    });
  }

  for (let index = 1; index <= arcSampleCount; index += 1) {
    const angle = -Math.PI / 2 + (index / arcSampleCount) * (Math.PI / 2);
    appendPoint({
      x: innerHalfWidth + Math.cos(angle) * cornerRadiusX,
      y: -innerHalfHeight + Math.sin(angle) * cornerRadiusY,
    });
  }

  for (let index = 1; index <= straightSampleCount; index += 1) {
    const progress = index / straightSampleCount;
    appendPoint({
      x: halfWidth,
      y: -innerHalfHeight + progress * innerHalfHeight * 2,
    });
  }

  for (let index = 1; index <= arcSampleCount; index += 1) {
    const angle = index / arcSampleCount * (Math.PI / 2);
    appendPoint({
      x: innerHalfWidth + Math.cos(angle) * cornerRadiusX,
      y: innerHalfHeight + Math.sin(angle) * cornerRadiusY,
    });
  }

  for (let index = 1; index <= straightSampleCount; index += 1) {
    const progress = index / straightSampleCount;
    appendPoint({
      x: innerHalfWidth * (1 - progress),
      y: halfHeight,
    });
  }

  return points;
};

const buildPointsFromCumulativeLengths = ({
  totalSeats,
  sampledPoints,
  cumulativeLengths,
}: {
  totalSeats: number;
  sampledPoints: OrbitPoint[];
  cumulativeLengths: number[];
}) => {
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;
  if (totalLength <= 0) {
    return null;
  }

  const points: OrbitPoint[] = [];
  let searchIndex = 0;

  for (let seatIndex = 0; seatIndex < totalSeats; seatIndex += 1) {
    const targetLength = (totalLength * seatIndex) / totalSeats;

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

  return points.length === totalSeats ? points : null;
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
  const sampledPoints = buildSampledEllipsePoints({
    radiusX,
    radiusY,
    sampleCount: safeSampleCount,
    startAngle,
  });
  const cumulativeLengths = buildCumulativeLengths(sampledPoints);
  return buildPointsFromCumulativeLengths({
    totalSeats: safeSeatCount,
    sampledPoints,
    cumulativeLengths,
  });
};

export const buildVisualBalancedEllipsePoints = ({
  totalSeats,
  radiusX,
  radiusY,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  startAngle = DEFAULT_START_ANGLE,
  orientationWeight = DEFAULT_VISUAL_BALANCE_ORIENTATION_WEIGHT,
  orientationExponent = DEFAULT_VISUAL_BALANCE_ORIENTATION_EXPONENT,
}: {
  totalSeats: number;
  radiusX: number;
  radiusY: number;
  sampleCount?: number;
  startAngle?: number;
  orientationWeight?: number;
  orientationExponent?: number;
}): OrbitPoint[] | null => {
  if (
    totalSeats <= 0 ||
    radiusX <= 0 ||
    radiusY <= 0 ||
    sampleCount <= 0 ||
    orientationWeight < 0 ||
    orientationExponent <= 0
  ) {
    return null;
  }

  const safeSampleCount = Math.max(180, Math.floor(sampleCount));
  const safeSeatCount = Math.floor(totalSeats);
  const sampledPoints = buildSampledEllipsePoints({
    radiusX,
    radiusY,
    sampleCount: safeSampleCount,
    startAngle,
  });
  const cumulativeLengths = buildCumulativeLengths(
    sampledPoints,
    ({ dx, length }) => {
      const horizontalness = length > 0 ? Math.abs(dx) / length : 0;
      return (
        1 +
        orientationWeight *
          (1 - Math.pow(horizontalness, orientationExponent))
      );
    },
  );

  return buildPointsFromCumulativeLengths({
    totalSeats: safeSeatCount,
    sampledPoints,
    cumulativeLengths,
  });
};

export const buildEqualPerimeterRoundedRailPoints = ({
  totalSeats,
  halfWidth,
  halfHeight,
  cornerRadiusX = halfWidth * DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_X_RATIO,
  cornerRadiusY = halfHeight * DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_Y_RATIO,
  sampleCount = DEFAULT_SAMPLE_COUNT,
}: {
  totalSeats: number;
  halfWidth: number;
  halfHeight: number;
  cornerRadiusX?: number;
  cornerRadiusY?: number;
  sampleCount?: number;
}): OrbitPoint[] | null => {
  if (
    totalSeats <= 0 ||
    halfWidth <= 0 ||
    halfHeight <= 0 ||
    sampleCount <= 0 ||
    cornerRadiusX < 0 ||
    cornerRadiusY < 0
  ) {
    return null;
  }

  const safeSeatCount = Math.floor(totalSeats);
  const safeSampleCount = Math.max(180, Math.floor(sampleCount));
  const straightSampleCount = Math.max(32, Math.floor(safeSampleCount / 8));
  const arcSampleCount = Math.max(24, Math.floor(safeSampleCount / 10));
  const safeCornerRadiusX = Math.min(halfWidth, cornerRadiusX);
  const safeCornerRadiusY = Math.min(halfHeight, cornerRadiusY);
  const sampledPoints = buildSampledRoundedRailPoints({
    halfWidth,
    halfHeight,
    cornerRadiusX: safeCornerRadiusX,
    cornerRadiusY: safeCornerRadiusY,
    straightSampleCount,
    arcSampleCount,
  });
  const cumulativeLengths = buildCumulativeLengths(sampledPoints);

  return buildPointsFromCumulativeLengths({
    totalSeats: safeSeatCount,
    sampledPoints,
    cumulativeLengths,
  });
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

export const buildVisualBalancedEllipsePercentAnchors = ({
  totalSeats,
  radiusXPercent,
  radiusYPercent,
  centerXPercent = 50,
  centerYPercent = 50,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  startAngle = DEFAULT_START_ANGLE,
  orientationWeight = DEFAULT_VISUAL_BALANCE_ORIENTATION_WEIGHT,
  orientationExponent = DEFAULT_VISUAL_BALANCE_ORIENTATION_EXPONENT,
}: {
  totalSeats: number;
  radiusXPercent: number;
  radiusYPercent: number;
  centerXPercent?: number;
  centerYPercent?: number;
  sampleCount?: number;
  startAngle?: number;
  orientationWeight?: number;
  orientationExponent?: number;
}) => {
  const points = buildVisualBalancedEllipsePoints({
    totalSeats,
    radiusX: radiusXPercent,
    radiusY: radiusYPercent,
    sampleCount,
    startAngle,
    orientationWeight,
    orientationExponent,
  });
  if (!points) {
    return null;
  }

  return points.map((point) => ({
    left: `${(centerXPercent + point.x).toFixed(2)}%`,
    top: `${(centerYPercent + point.y).toFixed(2)}%`,
  }));
};

export const buildEqualPerimeterRoundedRailPercentAnchors = ({
  totalSeats,
  halfWidthPercent,
  halfHeightPercent,
  centerXPercent = 50,
  centerYPercent = 50,
  cornerRadiusXPercent = halfWidthPercent * DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_X_RATIO,
  cornerRadiusYPercent = halfHeightPercent * DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_Y_RATIO,
  sampleCount = DEFAULT_SAMPLE_COUNT,
}: {
  totalSeats: number;
  halfWidthPercent: number;
  halfHeightPercent: number;
  centerXPercent?: number;
  centerYPercent?: number;
  cornerRadiusXPercent?: number;
  cornerRadiusYPercent?: number;
  sampleCount?: number;
}) => {
  const points = buildEqualPerimeterRoundedRailPoints({
    totalSeats,
    halfWidth: halfWidthPercent,
    halfHeight: halfHeightPercent,
    cornerRadiusX: cornerRadiusXPercent,
    cornerRadiusY: cornerRadiusYPercent,
    sampleCount,
  });
  if (!points) {
    return null;
  }

  return points.map((point) => ({
    left: `${(centerXPercent + point.x).toFixed(2)}%`,
    top: `${(centerYPercent + point.y).toFixed(2)}%`,
  }));
};

export const buildEqualPerimeterRoundedRailPercentAnchorsForFrame = ({
  totalSeats,
  feltWidthPx,
  feltHeightPx,
  halfWidthPercent,
  halfHeightPercent,
  centerXPercent = 50,
  centerYPercent = 50,
  cornerRadiusXPercent = halfWidthPercent * DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_X_RATIO,
  cornerRadiusYPercent = halfHeightPercent * DEFAULT_ROUNDED_RAIL_CORNER_RADIUS_Y_RATIO,
  sampleCount = DEFAULT_SAMPLE_COUNT,
}: {
  totalSeats: number;
  feltWidthPx: number;
  feltHeightPx: number;
  halfWidthPercent: number;
  halfHeightPercent: number;
  centerXPercent?: number;
  centerYPercent?: number;
  cornerRadiusXPercent?: number;
  cornerRadiusYPercent?: number;
  sampleCount?: number;
}) => {
  if (feltWidthPx <= 0 || feltHeightPx <= 0) {
    return null;
  }

  const points = buildEqualPerimeterRoundedRailPoints({
    totalSeats,
    halfWidth: feltWidthPx * (halfWidthPercent / 100),
    halfHeight: feltHeightPx * (halfHeightPercent / 100),
    cornerRadiusX: feltWidthPx * (cornerRadiusXPercent / 100),
    cornerRadiusY: feltHeightPx * (cornerRadiusYPercent / 100),
    sampleCount,
  });
  if (!points) {
    return null;
  }

  return points.map((point) => ({
    left: `${(centerXPercent + (point.x / feltWidthPx) * 100).toFixed(2)}%`,
    top: `${(centerYPercent + (point.y / feltHeightPx) * 100).toFixed(2)}%`,
  }));
};
