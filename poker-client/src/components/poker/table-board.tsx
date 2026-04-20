import React, { useLayoutEffect, useRef } from "react";
import type { Card as PokerCard } from "poker-types";
import { Card } from "@/components/Card";
import { CommunityCardsLane } from "@/components/poker/community-cards-lane";
import { PotDropZone } from "@/components/poker/pot-drop-zone";
import { SeatPod, type SeatBadge, type SeatLiveAudioBadge } from "@/components/poker/seat-pod";
import { buildDenseMobileSeatBorderLayout } from "@/components/poker/table-board-layout";

type SeatMainState = "turn" | "disconnected" | "all-in" | "folded" | "waiting" | "default";

type SeatActionLabel = {
  text: string;
  tone: "blind" | "aggressive" | "call" | "allin" | "pending";
};

type SeatOrbitItem = {
  slotIndex: number;
  top: string;
  left: string;
  width: string;
  playerId: string;
  playerEmoji: string;
  playerName: string;
  isYou: boolean;
  badge?: SeatBadge | null;
  liveAudioBadge?: SeatLiveAudioBadge | null;
  externalStatusLabel: string | null;
  externalStatusToneClass: string;
  internalStatusLabel: string | null;
  internalStatusToneClass: string;
  actionLabel: SeatActionLabel | null;
  remainingLabel: string;
  seatState: SeatMainState;
  densityClass: string;
  readyOverlayLabel?: string | null;
};

type TableBoardProps = {
  feltOvalRef: React.RefObject<HTMLDivElement | null>;
  boardCenterStackRef: React.RefObject<HTMLDivElement | null>;
  communityLaneRef: React.RefObject<HTMLDivElement | null>;
  potDropZoneRef: React.RefObject<HTMLDivElement | null>;
  setSeatNodeRef: (playerId: string, node: HTMLDivElement | null) => void;
  communitySlots: Array<PokerCard | null>;
  isYourTurn: boolean;
  isDragOverDropZone: boolean;
  potLabel: string;
  potValue: string;
  potHint: string | null;
  potPulse: boolean;
  seatOrbitItems: SeatOrbitItem[];
};

const UNIFORM_WIDTH_TEXT_SELECTORS = [
  ".seat-pod__remaining",
];
const BOARD_COLLISION_SELECTORS = [
  '[data-testid="pot-drop-zone"]',
  '[data-testid^="community-card-"]',
  '[data-testid^="board-back-"]',
];
const SEAT_OVERFLOW_TOLERANCE_PX = 0.5;
const SEAT_LAYOUT_MARGIN_PX = 2;
const SEAT_LAYOUT_COLLISION_TOLERANCE_PX = 0.5;
const MOBILE_SEAT_BORDER_OFFSET_MAX_WIDTH_PX = 430;
const SEAT_WIDTH_SOLVER_STEPS = 12;
const SEAT_BORDER_OFFSET_SOLVER_STEPS = 14;
const SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX = 14;
const SEAT_BORDER_TARGET_GAP_VERTICAL_PX = 9;
const DENSE_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX = 4;
const DENSE_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX = 4;
const EIGHT_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX = 9;
const EIGHT_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX = 8;
const TEN_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX = 8;
const TEN_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX = 8;
const TWELVE_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX = 7;
const TWELVE_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX = 8;
const THIRTEEN_PLUS_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX = 6;
const THIRTEEN_PLUS_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX = 7;
const DENSE_MOBILE_SEAT_WIDTH_TARGET_EXPANSION_RATIO = 1.18;
const DENSE_MOBILE_SEAT_WIDTH_MAX_FELT_RATIO = 0.235;
const ULTRA_DENSE_MOBILE_SEAT_WIDTH_TARGET_EXPANSION_RATIO = 1.26;
const ULTRA_DENSE_MOBILE_SEAT_WIDTH_MAX_FELT_RATIO = 0.25;
const SEAT_WIDTH_MAX_EXPANSION_RATIO = 1.4;
const SEAT_WIDTH_EXPANSION_MULTIPLIER = 1.22;
const SEAT_WIDTH_EXPANSION_PROBE_STEPS = 10;
const SEAT_WIDTH_MAX_FELT_RATIO = 0.22;
const COMMUNITY_SLOT_META = [
  { id: "flop-1", position: 0, revealDelayMs: 0, revealedTestId: "community-card-0", hiddenTestId: "board-back-0" },
  {
    id: "flop-2",
    position: 1,
    revealDelayMs: 70,
    revealedTestId: "community-card-1",
    hiddenTestId: "board-back-1",
  },
  {
    id: "flop-3",
    position: 2,
    revealDelayMs: 140,
    revealedTestId: "community-card-2",
    hiddenTestId: "board-back-2",
  },
  {
    id: "turn",
    position: 3,
    revealDelayMs: 210,
    revealedTestId: "community-card-3",
    hiddenTestId: "board-back-3",
  },
  {
    id: "river",
    position: 4,
    revealDelayMs: 280,
    revealedTestId: "community-card-4",
    hiddenTestId: "board-back-4",
  },
] as const;

const parseLengthToPixels = ({
  token,
  rootFontSize,
  viewportWidth,
}: {
  token: string;
  rootFontSize: number;
  viewportWidth: number;
}) => {
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return 0;
  }

  if (normalizedToken.endsWith("rem")) {
    return Number.parseFloat(normalizedToken) * rootFontSize;
  }

  if (normalizedToken.endsWith("vw")) {
    return (Number.parseFloat(normalizedToken) / 100) * viewportWidth;
  }

  if (normalizedToken.endsWith("px")) {
    return Number.parseFloat(normalizedToken);
  }

  const parsed = Number.parseFloat(normalizedToken);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveSeatBaseWidthPx = (widthToken: string) => {
  const rootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize || "16",
  );
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const normalizedToken = widthToken.replace(/\s+/g, "");
  const clampMatch = normalizedToken.match(/^clamp\(([^,]+),([^,]+),([^)]+)\)$/i);

  if (!clampMatch) {
    return parseLengthToPixels({
      token: normalizedToken,
      rootFontSize,
      viewportWidth,
    });
  }

  const minValue = parseLengthToPixels({
    token: clampMatch[1],
    rootFontSize,
    viewportWidth,
  });
  const preferredValue = parseLengthToPixels({
    token: clampMatch[2],
    rootFontSize,
    viewportWidth,
  });
  const maxValue = parseLengthToPixels({
    token: clampMatch[3],
    rootFontSize,
    viewportWidth,
  });
  return Math.max(minValue, Math.min(maxValue, preferredValue));
};

const resetInlineSeatFontSizes = (seatOrbitNode: HTMLElement) => {
  UNIFORM_WIDTH_TEXT_SELECTORS.forEach((selector) => {
    seatOrbitNode.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      node.style.fontSize = "";
    });
  });
};

const hasNonNameTextOverflow = (seatOrbitNode: HTMLElement) =>
  UNIFORM_WIDTH_TEXT_SELECTORS.some((selector) =>
    Array.from(seatOrbitNode.querySelectorAll<HTMLElement>(selector)).some((node) => {
      const text = (node.textContent || "").trim();
      if (!text) {
        return false;
      }
      return (
        node.scrollWidth > node.clientWidth + SEAT_OVERFLOW_TOLERANCE_PX ||
        node.scrollHeight > node.clientHeight + SEAT_OVERFLOW_TOLERANCE_PX
      );
    }),
  );

const overlapExceedsTolerance = (a: DOMRect, b: DOMRect) => {
  const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return (
    overlapWidth > SEAT_LAYOUT_COLLISION_TOLERANCE_PX &&
    overlapHeight > SEAT_LAYOUT_COLLISION_TOLERANCE_PX
  );
};

const isSeatLayoutSafe = ({
  feltNode,
  seatOrbitNode,
}: {
  feltNode: HTMLElement;
  seatOrbitNode: HTMLElement;
}) => {
  const feltRect = feltNode.getBoundingClientRect();
  const seatRects = Array.from(
    seatOrbitNode.querySelectorAll<HTMLElement>('.seat-pod[data-testid^="player-seat-"]'),
  ).map((node) => node.getBoundingClientRect());

  if (seatRects.some((seatRect) => {
    return (
      seatRect.left < feltRect.left + SEAT_LAYOUT_MARGIN_PX ||
      seatRect.right > feltRect.right - SEAT_LAYOUT_MARGIN_PX ||
      seatRect.top < feltRect.top + SEAT_LAYOUT_MARGIN_PX ||
      seatRect.bottom > feltRect.bottom - SEAT_LAYOUT_MARGIN_PX
    );
  })) {
    return false;
  }

  const boardRects = BOARD_COLLISION_SELECTORS.flatMap((selector) =>
    Array.from(feltNode.querySelectorAll<HTMLElement>(selector)).map((node) =>
      node.getBoundingClientRect(),
    ),
  );

  if (
    seatRects.some((seatRect) =>
      boardRects.some((boardRect) => overlapExceedsTolerance(seatRect, boardRect)),
    )
  ) {
    return false;
  }

  for (let first = 0; first < seatRects.length; first += 1) {
    for (let second = first + 1; second < seatRects.length; second += 1) {
      if (overlapExceedsTolerance(seatRects[first], seatRects[second])) {
        return false;
      }
    }
  }

  return true;
};

const setUniformSeatWidth = (seatOrbitNode: HTMLElement, widthPx: number | null) => {
  if (widthPx === null) {
    seatOrbitNode.style.removeProperty("--seat-slot-width-uniform");
    return;
  }
  seatOrbitNode.style.setProperty("--seat-slot-width-uniform", `${widthPx}px`);
};

const getSeatSlotNodes = (seatOrbitNode: HTMLElement) =>
  Array.from(seatOrbitNode.querySelectorAll<HTMLElement>(".seat-orbit__slot"));

const clearSeatSlotOffsets = (seatOrbitNode: HTMLElement) => {
  getSeatSlotNodes(seatOrbitNode).forEach((slotNode) => {
    slotNode.style.removeProperty("--seat-slot-offset-x");
    slotNode.style.removeProperty("--seat-slot-offset-y");
  });
};

const setSeatSlotOffset = ({
  slotNode,
  offsetX,
  offsetY,
}: {
  slotNode: HTMLElement;
  offsetX: number;
  offsetY: number;
}) => {
  slotNode.style.setProperty("--seat-slot-offset-x", `${offsetX}px`);
  slotNode.style.setProperty("--seat-slot-offset-y", `${offsetY}px`);
};

const getDenseMobileSeatBorderTargetGaps = (seatCount: number) =>
  seatCount === 8
    ? {
        horizontalGapPx: EIGHT_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX,
        verticalGapPx: EIGHT_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX,
      }
    : seatCount === 10
      ? {
          horizontalGapPx: TEN_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX,
          verticalGapPx: TEN_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX,
        }
      : seatCount === 12
        ? {
            horizontalGapPx: TWELVE_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX,
            verticalGapPx: TWELVE_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX,
          }
        : seatCount >= 13
          ? {
              horizontalGapPx: THIRTEEN_PLUS_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX,
              verticalGapPx: THIRTEEN_PLUS_HANDED_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX,
            }
    : {
        horizontalGapPx: DENSE_MOBILE_SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX,
        verticalGapPx: DENSE_MOBILE_SEAT_BORDER_TARGET_GAP_VERTICAL_PX,
      };

const getDenseMobileSeatWidthTargets = (seatCount: number) =>
  seatCount >= 12
    ? {
        targetExpansionRatio: ULTRA_DENSE_MOBILE_SEAT_WIDTH_TARGET_EXPANSION_RATIO,
        maxFeltRatio: ULTRA_DENSE_MOBILE_SEAT_WIDTH_MAX_FELT_RATIO,
      }
    : {
        targetExpansionRatio: DENSE_MOBILE_SEAT_WIDTH_TARGET_EXPANSION_RATIO,
        maxFeltRatio: DENSE_MOBILE_SEAT_WIDTH_MAX_FELT_RATIO,
      };

const resolveDenseMobileSeatBorderOffsets = ({
  feltNode,
  seatOrbitNode,
  seatCount,
}: {
  feltNode: HTMLElement;
  seatOrbitNode: HTMLElement;
  seatCount: number;
}) => {
  clearSeatSlotOffsets(seatOrbitNode);

  const feltRect = feltNode.getBoundingClientRect();
  const slotNodes = getSeatSlotNodes(seatOrbitNode)
    .map((slotNode) => {
      const seatNode = slotNode.querySelector<HTMLElement>('.seat-pod[data-testid^="player-seat-"]');
      if (!seatNode) {
        return null;
      }

      const seatRect = seatNode.getBoundingClientRect();
      return {
        slotNode,
        seatCenterX: seatRect.left - feltRect.left + seatRect.width / 2,
        seatCenterY: seatRect.top - feltRect.top + seatRect.height / 2,
        width: seatRect.width,
        height: seatRect.height,
      };
    })
    .filter((slot): slot is {
      slotNode: HTMLElement;
      seatCenterX: number;
      seatCenterY: number;
      width: number;
      height: number;
    } => Boolean(slot));

  const targetGaps = getDenseMobileSeatBorderTargetGaps(seatCount);
  const layout = buildDenseMobileSeatBorderLayout({
    feltWidth: feltRect.width,
    feltHeight: feltRect.height,
    seats: slotNodes.map((slotNode) => ({
      x: slotNode.seatCenterX,
      y: slotNode.seatCenterY,
      width: slotNode.width,
      height: slotNode.height,
    })),
    horizontalGapPx: targetGaps.horizontalGapPx,
    verticalGapPx: targetGaps.verticalGapPx,
  });

  if (!layout || !layout.safe || layout.points.length !== slotNodes.length) {
    clearSeatSlotOffsets(seatOrbitNode);
    return false;
  }

  slotNodes.forEach((slotNode, index) => {
    const targetPoint = layout.points[index];
    setSeatSlotOffset({
      slotNode: slotNode.slotNode,
      offsetX: targetPoint.x - slotNode.seatCenterX,
      offsetY: targetPoint.y - slotNode.seatCenterY,
    });
  });

  if (!isSeatLayoutSafe({ feltNode, seatOrbitNode })) {
    clearSeatSlotOffsets(seatOrbitNode);
    return false;
  }

  return true;
};

const resolveSeatSlotBorderOffsets = ({
  feltNode,
  seatOrbitNode,
  seatCount,
}: {
  feltNode: HTMLElement;
  seatOrbitNode: HTMLElement;
  seatCount: number;
}) => {
  clearSeatSlotOffsets(seatOrbitNode);

  const feltRect = feltNode.getBoundingClientRect();
  const centerX = feltRect.left + feltRect.width / 2;
  const centerY = feltRect.top + feltRect.height / 2;
  const maxProbeDistance = Math.max(feltRect.width, feltRect.height);
  const slotNodes = getSeatSlotNodes(seatOrbitNode)
    .map((slotNode) => {
      const seatNode = slotNode.querySelector<HTMLElement>('.seat-pod[data-testid^="player-seat-"]');
      if (!seatNode) {
        return null;
      }

      const seatRect = seatNode.getBoundingClientRect();
      const seatCenterX = seatRect.left + seatRect.width / 2;
      const seatCenterY = seatRect.top + seatRect.height / 2;
      const vectorX = seatCenterX - centerX;
      const vectorY = seatCenterY - centerY;
      const vectorLength = Math.hypot(vectorX, vectorY);

      if (vectorLength <= SEAT_LAYOUT_COLLISION_TOLERANCE_PX) {
        return null;
      }

      return {
        slotNode,
        unitX: vectorX / vectorLength,
        unitY: vectorY / vectorLength,
        priority: Math.abs(vectorY) - Math.abs(vectorX),
      };
    })
    .filter((slot): slot is {
      slotNode: HTMLElement;
      unitX: number;
      unitY: number;
      priority: number;
    } => Boolean(slot))
    .sort((a, b) => b.priority - a.priority);

  slotNodes.forEach(({ slotNode, unitX, unitY }) => {
    let low = 0;
    let high = maxProbeDistance;

    for (let step = 0; step < SEAT_BORDER_OFFSET_SOLVER_STEPS; step += 1) {
      const mid = (low + high) / 2;
      setSeatSlotOffset({
        slotNode,
        offsetX: unitX * mid,
        offsetY: unitY * mid,
      });

      if (isSeatLayoutSafe({ feltNode, seatOrbitNode })) {
        low = mid;
        continue;
      }

      high = mid;
    }

    const axisBlend = Math.min(1, Math.abs(unitY));
    const denseTargetGaps = getDenseMobileSeatBorderTargetGaps(seatCount);
    const horizontalGapPx =
      seatCount > 6
        ? denseTargetGaps.horizontalGapPx
        : SEAT_BORDER_TARGET_GAP_HORIZONTAL_PX;
    const verticalGapPx =
      seatCount > 6
        ? denseTargetGaps.verticalGapPx
        : SEAT_BORDER_TARGET_GAP_VERTICAL_PX;
    const targetGapPx = horizontalGapPx * (1 - axisBlend) + verticalGapPx * axisBlend;
    const settledDistance = Math.max(0, low - targetGapPx);
    setSeatSlotOffset({
      slotNode,
      offsetX: unitX * settledDistance,
      offsetY: unitY * settledDistance,
    });
  });
};

const resolveDenseMobileSeatWidth = ({
  feltNode,
  seatOrbitNode,
  seatWidthToken,
  seatCount,
}: {
  feltNode: HTMLElement;
  seatOrbitNode: HTMLElement;
  seatWidthToken: string;
  seatCount: number;
}) => {
  const baseWidthPx = resolveSeatBaseWidthPx(seatWidthToken);
  if (!Number.isFinite(baseWidthPx) || baseWidthPx <= 0) {
    return null;
  }

  const feltWidthPx = feltNode.getBoundingClientRect().width;
  const widthTargets = getDenseMobileSeatWidthTargets(seatCount);
  const maxWidthPx = Math.max(
    baseWidthPx + SEAT_OVERFLOW_TOLERANCE_PX,
    Math.min(
      baseWidthPx * widthTargets.targetExpansionRatio,
      feltWidthPx * widthTargets.maxFeltRatio,
    ),
  );

  if (maxWidthPx <= baseWidthPx + SEAT_OVERFLOW_TOLERANCE_PX) {
    setUniformSeatWidth(seatOrbitNode, null);
    clearSeatSlotOffsets(seatOrbitNode);
    return null;
  }

  let bestWidthPx = baseWidthPx;
  let low = baseWidthPx;
  let high = maxWidthPx;

  for (let step = 0; step < SEAT_WIDTH_SOLVER_STEPS; step += 1) {
    const candidateWidthPx = (low + high) / 2;
    setUniformSeatWidth(seatOrbitNode, candidateWidthPx);
    resetInlineSeatFontSizes(seatOrbitNode);

    const resolvedLayout = resolveDenseMobileSeatBorderOffsets({
      feltNode,
      seatOrbitNode,
      seatCount: seatOrbitNode.querySelectorAll('.seat-pod[data-testid^="player-seat-"]').length,
    });
    if (resolvedLayout && isSeatLayoutSafe({ feltNode, seatOrbitNode })) {
      bestWidthPx = candidateWidthPx;
      low = candidateWidthPx;
      continue;
    }

    high = candidateWidthPx;
  }

  if (bestWidthPx <= baseWidthPx + SEAT_OVERFLOW_TOLERANCE_PX) {
    setUniformSeatWidth(seatOrbitNode, null);
    clearSeatSlotOffsets(seatOrbitNode);
    return null;
  }

  return bestWidthPx;
};

const resolveUniformSeatWidth = ({
  feltNode,
  seatOrbitNode,
  seatWidthToken,
}: {
  feltNode: HTMLElement;
  seatOrbitNode: HTMLElement;
  seatWidthToken: string;
}) => {
  const baseWidthPx = resolveSeatBaseWidthPx(seatWidthToken);
  if (!Number.isFinite(baseWidthPx) || baseWidthPx <= 0) {
    return null;
  }

  setUniformSeatWidth(seatOrbitNode, null);
  resetInlineSeatFontSizes(seatOrbitNode);

  if (!hasNonNameTextOverflow(seatOrbitNode)) {
    return null;
  }

  const feltWidthPx = feltNode.getBoundingClientRect().width;
  const maxWidthPxByRatio = baseWidthPx * SEAT_WIDTH_MAX_EXPANSION_RATIO;
  const maxWidthPxByFelt = feltWidthPx * SEAT_WIDTH_MAX_FELT_RATIO;
  const maxWidthPx = Math.max(
    baseWidthPx + SEAT_OVERFLOW_TOLERANCE_PX,
    Math.min(maxWidthPxByRatio, maxWidthPxByFelt),
  );

  let maxSafeWidthPx = baseWidthPx;
  let probeWidthPx = baseWidthPx;

  for (let step = 0; step < SEAT_WIDTH_EXPANSION_PROBE_STEPS; step += 1) {
    const candidateWidthPx = Math.min(
      maxWidthPx,
      probeWidthPx * SEAT_WIDTH_EXPANSION_MULTIPLIER,
    );

    if (candidateWidthPx <= probeWidthPx + SEAT_OVERFLOW_TOLERANCE_PX) {
      break;
    }

    setUniformSeatWidth(seatOrbitNode, candidateWidthPx);
    resetInlineSeatFontSizes(seatOrbitNode);

    if (isSeatLayoutSafe({ feltNode, seatOrbitNode })) {
      maxSafeWidthPx = candidateWidthPx;
      probeWidthPx = candidateWidthPx;
      if (!hasNonNameTextOverflow(seatOrbitNode)) {
        break;
      }
      continue;
    }

    let low = probeWidthPx;
    let high = candidateWidthPx;
    for (let innerStep = 0; innerStep < SEAT_WIDTH_SOLVER_STEPS; innerStep += 1) {
      const mid = (low + high) / 2;
      setUniformSeatWidth(seatOrbitNode, mid);
      resetInlineSeatFontSizes(seatOrbitNode);
      if (isSeatLayoutSafe({ feltNode, seatOrbitNode })) {
        low = mid;
        continue;
      }
      high = mid;
    }
    maxSafeWidthPx = Math.max(maxSafeWidthPx, low);
    break;
  }

  if (maxSafeWidthPx <= baseWidthPx + SEAT_OVERFLOW_TOLERANCE_PX) {
    setUniformSeatWidth(seatOrbitNode, null);
    return null;
  }

  let requiredWidthPx = maxSafeWidthPx;
  let low = baseWidthPx;
  let high = maxSafeWidthPx;

  for (let step = 0; step < SEAT_WIDTH_SOLVER_STEPS; step += 1) {
    const candidateWidthPx = (low + high) / 2;
    setUniformSeatWidth(seatOrbitNode, candidateWidthPx);
    resetInlineSeatFontSizes(seatOrbitNode);

    const layoutSafe = isSeatLayoutSafe({ feltNode, seatOrbitNode });
    if (layoutSafe && !hasNonNameTextOverflow(seatOrbitNode)) {
      requiredWidthPx = candidateWidthPx;
      high = candidateWidthPx;
      continue;
    }

    low = candidateWidthPx;
  }

  return requiredWidthPx > baseWidthPx + SEAT_OVERFLOW_TOLERANCE_PX
    ? requiredWidthPx
    : null;
};

export const TableBoard: React.FC<TableBoardProps> = ({
  feltOvalRef,
  boardCenterStackRef,
  communityLaneRef,
  potDropZoneRef,
  setSeatNodeRef,
  communitySlots,
  isYourTurn,
  isDragOverDropZone,
  potLabel,
  potValue,
  potHint,
  potPulse,
  seatOrbitItems,
}) => {
  const seatOrbitRef = useRef<HTMLDivElement | null>(null);
  const baseSeatWidthToken = seatOrbitItems[0]?.width ?? null;
  const seatOrbitItemCount = seatOrbitItems.length;

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const feltNode = feltOvalRef.current;
    const seatOrbitNode = seatOrbitRef.current;

    if (!feltNode || !seatOrbitNode || !baseSeatWidthToken) {
      return;
    }

    let rafId = 0;
    const scheduleSolve = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        clearSeatSlotOffsets(seatOrbitNode);
        const isDenseMobileSeatOrbit =
          seatOrbitItemCount > 6 &&
          feltNode.getBoundingClientRect().width <= MOBILE_SEAT_BORDER_OFFSET_MAX_WIDTH_PX;
        const uniformSeatWidth = isDenseMobileSeatOrbit
          ? resolveDenseMobileSeatWidth({
              feltNode,
              seatOrbitNode,
              seatWidthToken: baseSeatWidthToken,
              seatCount: seatOrbitItemCount,
            }) ??
            resolveUniformSeatWidth({
              feltNode,
              seatOrbitNode,
              seatWidthToken: baseSeatWidthToken,
            })
          : resolveUniformSeatWidth({
              feltNode,
              seatOrbitNode,
              seatWidthToken: baseSeatWidthToken,
            });
        setUniformSeatWidth(seatOrbitNode, uniformSeatWidth);
        if (feltNode.getBoundingClientRect().width <= MOBILE_SEAT_BORDER_OFFSET_MAX_WIDTH_PX) {
          const resolvedDenseMobileLayout =
            seatOrbitItemCount > 6 &&
            resolveDenseMobileSeatBorderOffsets({
              feltNode,
              seatOrbitNode,
              seatCount: seatOrbitItemCount,
            });
          if (!resolvedDenseMobileLayout) {
            resolveSeatSlotBorderOffsets({
              feltNode,
              seatOrbitNode,
              seatCount: seatOrbitItemCount,
            });
          }
        }
      });
    };

    scheduleSolve();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleSolve) : null;
    resizeObserver?.observe(feltNode);
    resizeObserver?.observe(seatOrbitNode);
    if (boardCenterStackRef.current) {
      resizeObserver?.observe(boardCenterStackRef.current);
    }
    if (communityLaneRef.current) {
      resizeObserver?.observe(communityLaneRef.current);
    }
    if (potDropZoneRef.current) {
      resizeObserver?.observe(potDropZoneRef.current);
    }

    const mutationObserver = new MutationObserver(scheduleSolve);
    mutationObserver.observe(seatOrbitNode, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    if (boardCenterStackRef.current) {
      mutationObserver.observe(boardCenterStackRef.current, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }

    window.addEventListener("resize", scheduleSolve);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleSolve);
      seatOrbitNode.style.removeProperty("--seat-slot-width-uniform");
      clearSeatSlotOffsets(seatOrbitNode);
    };
  }, [
    boardCenterStackRef,
    communityLaneRef,
    feltOvalRef,
    potDropZoneRef,
    baseSeatWidthToken,
    seatOrbitItemCount,
  ]);

  return (
    <section className="table-board-wrap" data-testid="table-board-section">
      <div ref={feltOvalRef} className="felt-oval">
        <div ref={boardCenterStackRef} className="board-center-stack">
          <div ref={communityLaneRef}>
            <CommunityCardsLane>
              {COMMUNITY_SLOT_META.map((slotMeta) => {
                const card = communitySlots[slotMeta.position] ?? null;
                const isRevealed = Boolean(card);
                return (
                  <div
                    key={`community-slot-${slotMeta.id}-${card ? `${card.suit}-${card.rank}` : "back"}`}
                    className={isRevealed ? "community-reveal" : ""}
                    style={isRevealed ? { animationDelay: `${slotMeta.revealDelayMs}ms` } : undefined}
                  >
                    <Card
                      card={card}
                      size="medium"
                      faceDown={!isRevealed}
                      dataTestId={isRevealed ? slotMeta.revealedTestId : slotMeta.hiddenTestId}
                    />
                  </div>
                );
              })}
            </CommunityCardsLane>
          </div>

          <div ref={potDropZoneRef}>
            <PotDropZone
              active={isYourTurn}
              hover={isDragOverDropZone}
              label={potLabel}
              value={potValue}
              hint={potHint}
              pulse={potPulse}
            />
          </div>
        </div>

        <div ref={seatOrbitRef} className="seat-orbit" data-testid="players-section">
          {seatOrbitItems.map((item) => (
            <div
              key={`seat-slot-${item.slotIndex}`}
              className="seat-orbit__slot"
              style={{
                top: item.top,
                left: item.left,
                width: `var(--seat-slot-width-uniform, ${item.width})`,
                transform:
                  "translate(calc(-50% + var(--seat-slot-offset-x, 0px)), calc(-50% + var(--seat-slot-offset-y, 0px)))",
              }}
            >
              <div ref={(node) => setSeatNodeRef(item.playerId, node)}>
                <SeatPod
                  testId={`player-seat-${item.playerId}`}
                  playerEmoji={item.playerEmoji}
                  playerName={item.playerName}
                  isYou={item.isYou}
                  badge={item.badge}
                  liveAudioBadge={item.liveAudioBadge}
                  externalStatusLabel={item.externalStatusLabel}
                  externalStatusToneClass={item.externalStatusToneClass}
                  internalStatusLabel={item.internalStatusLabel}
                  internalStatusToneClass={item.internalStatusToneClass}
                  actionLabel={item.actionLabel}
                  remainingLabel={item.remainingLabel}
                  seatState={item.seatState}
                  densityClass={item.densityClass}
                  readyOverlayLabel={item.readyOverlayLabel}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
