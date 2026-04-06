import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card as PokerCard } from "poker-types";
import { TableBoard } from "@/components/poker/table-board";
import { buildEqualArcEllipsePercentAnchors } from "@/components/poker/seat-orbit-layout";

const boardCards: Array<PokerCard | null> = [
  { rank: "A", suit: "spades" },
  { rank: "K", suit: "hearts" },
  { rank: "10", suit: "clubs" },
  null,
  null,
];
const feltOvalRef = React.createRef<HTMLDivElement>();
const boardCenterStackRef = React.createRef<HTMLDivElement>();
const communityLaneRef = React.createRef<HTMLDivElement>();
const potDropZoneRef = React.createRef<HTMLDivElement>();
type SeatOrbitItems = React.ComponentProps<typeof TableBoard>["seatOrbitItems"];

const seatOrbitItems: SeatOrbitItems = [
  {
    slotIndex: 0,
    top: "88%",
    left: "50%",
    width: "clamp(3.6rem, 12.4vw, 5.5rem)",
    playerId: "p1",
    playerEmoji: "🦊",
    playerName: "Kai",
    isYou: true,
    badge: { tone: "dealer", text: "BTN" },
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "Raise to $80", tone: "aggressive" as const },
    remainingLabel: "$920",
    seatState: "default" as const,
    densityClass: "seat-pod--compact",
  },
  {
    slotIndex: 1,
    top: "22%",
    left: "18%",
    width: "clamp(3.6rem, 12.4vw, 5.5rem)",
    playerId: "p2",
    playerEmoji: "🐼",
    playerName: "Maya",
    isYou: false,
    badge: { tone: "small-blind", text: "SB" },
    externalStatusLabel: "Acting",
    externalStatusToneClass: "seat-pod__status-badge--turn",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "Call $40", tone: "call" as const },
    remainingLabel: "$760",
    seatState: "turn" as const,
    densityClass: "seat-pod--compact",
  },
  {
    slotIndex: 2,
    top: "22%",
    left: "82%",
    width: "clamp(3.6rem, 12.4vw, 5.5rem)",
    playerId: "p3",
    playerEmoji: "🦁",
    playerName: "Noah",
    isYou: false,
    badge: { tone: "position", text: "BB" },
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "Folded",
    internalStatusToneClass: "seat-pod__status-badge--folded",
    actionLabel: { text: "Fold", tone: "pending" as const },
    remainingLabel: "$480",
    seatState: "folded" as const,
    densityClass: "seat-pod--compact",
  },
  {
    slotIndex: 3,
    top: "54%",
    left: "10%",
    width: "clamp(3.6rem, 12.4vw, 5.5rem)",
    playerId: "p4",
    playerEmoji: "🐙",
    playerName: "Luna",
    isYou: false,
    badge: null,
    externalStatusLabel: "Waiting",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "In next hand", tone: "pending" as const },
    remainingLabel: "$500",
    seatState: "waiting" as const,
    densityClass: "seat-pod--compact",
  },
  {
    slotIndex: 4,
    top: "54%",
    left: "90%",
    width: "clamp(3.6rem, 12.4vw, 5.5rem)",
    playerId: "p5",
    playerEmoji: "🐯",
    playerName: "Jin",
    isYou: false,
    badge: { tone: "position", text: "HJ" },
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "All-in",
    internalStatusToneClass: "seat-pod__status-badge--allin",
    actionLabel: { text: "All-in $640", tone: "allin" as const },
    remainingLabel: "$0",
    seatState: "all-in" as const,
    densityClass: "seat-pod--compact",
  },
  {
    slotIndex: 5,
    top: "12%",
    left: "50%",
    width: "clamp(3.6rem, 12.4vw, 5.5rem)",
    playerId: "p6",
    playerEmoji: "🦉",
    playerName: "Eve",
    isYou: false,
    badge: { tone: "position", text: "CO" },
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "Call $80", tone: "call" as const },
    remainingLabel: "$1,140",
    seatState: "default" as const,
    densityClass: "seat-pod--compact",
  },
];

const MOBILE_SEAT_SIDE_MARGIN_PERCENT = 12;

const clampSeatLeftPercent = (left: string): string => {
  const trimmedLeft = left.trim();
  if (!trimmedLeft.endsWith("%")) {
    return left;
  }

  const leftValue = Number.parseFloat(trimmedLeft.slice(0, -1));
  if (!Number.isFinite(leftValue)) {
    return left;
  }

  const clampedLeft = Math.max(
    MOBILE_SEAT_SIDE_MARGIN_PERCENT,
    Math.min(100 - MOBILE_SEAT_SIDE_MARGIN_PERCENT, leftValue),
  );
  return `${clampedLeft}%`;
};

const applyMobileSeatSideMargin = (seats: SeatOrbitItems): SeatOrbitItems =>
  seats.map((seat) => ({
    ...seat,
    left: clampSeatLeftPercent(seat.left),
  }));

const mobileSeatOrbitItems: SeatOrbitItems = applyMobileSeatSideMargin([
  {
    ...seatOrbitItems[0],
    top: "85.5%",
    left: "50%",
    width: "4.2rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[1],
    top: "27.5%",
    left: "18%",
    width: "4.2rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[2],
    top: "27.5%",
    left: "82%",
    width: "4.2rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[3],
    top: "60.5%",
    left: "12%",
    width: "4.2rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[4],
    top: "60.5%",
    left: "88%",
    width: "4.2rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[5],
    top: "14.5%",
    left: "50%",
    width: "4.2rem",
    densityClass: "seat-pod--dense" as const,
  },
]);

const mobileLandscapeSeatOrbitItems: SeatOrbitItems = applyMobileSeatSideMargin([
  {
    ...seatOrbitItems[0],
    top: "85.5%",
    left: "50%",
    width: "4rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[1],
    top: "27.5%",
    left: "16%",
    width: "4rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[2],
    top: "27.5%",
    left: "84%",
    width: "4rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[3],
    top: "61.5%",
    left: "10%",
    width: "4rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[4],
    top: "61.5%",
    left: "90%",
    width: "4rem",
    densityClass: "seat-pod--dense" as const,
  },
  {
    ...seatOrbitItems[5],
    top: "13.5%",
    left: "50%",
    width: "4rem",
    densityClass: "seat-pod--dense" as const,
  },
]);

const eightHandedStatusSeatOrbitItems: SeatOrbitItems = [
  {
    slotIndex: 0,
    top: "88%",
    left: "50%",
    width: "4.4rem",
    playerId: "e1",
    playerEmoji: "🦊",
    playerName: "你",
    isYou: true,
    badge: { tone: "dealer", text: "D" },
    externalStatusLabel: "已准备",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: null,
    remainingLabel: "$1,120",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 1,
    top: "76.9%",
    left: "20.3%",
    width: "4.4rem",
    playerId: "e2",
    playerEmoji: "🐼",
    playerName: "Maya",
    isYou: false,
    badge: { tone: "small-blind", text: "SB" },
    externalStatusLabel: "行动中",
    externalStatusToneClass: "seat-pod__status-badge--turn",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "考虑中…", tone: "pending" as const },
    remainingLabel: "$860",
    seatState: "turn" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 2,
    top: "50%",
    left: "8%",
    width: "4.4rem",
    playerId: "e3",
    playerEmoji: "🦁",
    playerName: "Noah",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "离线中",
    internalStatusToneClass: "seat-pod__status-badge--disconnected",
    actionLabel: null,
    remainingLabel: "$730",
    seatState: "disconnected" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 3,
    top: "23.1%",
    left: "20.3%",
    width: "4.4rem",
    playerId: "e4",
    playerEmoji: "🐙",
    playerName: "Luna",
    isYou: false,
    badge: null,
    externalStatusLabel: "等待中",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "下一手入局", tone: "pending" as const },
    remainingLabel: "$640",
    seatState: "waiting" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 4,
    top: "12%",
    left: "50%",
    width: "4.4rem",
    playerId: "e5",
    playerEmoji: "🐯",
    playerName: "Jin",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "弃牌",
    internalStatusToneClass: "seat-pod__status-badge--folded",
    actionLabel: { text: "Fold", tone: "pending" as const },
    remainingLabel: "$590",
    seatState: "folded" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 5,
    top: "23.1%",
    left: "79.7%",
    width: "4.4rem",
    playerId: "e6",
    playerEmoji: "🦉",
    playerName: "Eve",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "ALL-IN",
    internalStatusToneClass: "seat-pod__status-badge--allin",
    actionLabel: { text: "All-in $12,420", tone: "allin" as const },
    remainingLabel: "$0",
    seatState: "all-in" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 6,
    top: "50%",
    left: "92%",
    width: "4.4rem",
    playerId: "e7",
    playerEmoji: "🦄",
    playerName: "Ari",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "加注到 $80", tone: "aggressive" as const },
    remainingLabel: "$1,320",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 7,
    top: "76.9%",
    left: "79.7%",
    width: "4.4rem",
    playerId: "e8",
    playerEmoji: "🐧",
    playerName: "Ray",
    isYou: false,
    badge: null,
    externalStatusLabel: "已准备",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: null,
    remainingLabel: "$910",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
];

const tenHandedStatusSeatOrbitItems: SeatOrbitItems = [
  {
    slotIndex: 0,
    top: "88%",
    left: "50%",
    width: "4.15rem",
    playerId: "t1",
    playerEmoji: "🦊",
    playerName: "你",
    isYou: true,
    badge: { tone: "dealer", text: "D" },
    externalStatusLabel: "已准备",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: null,
    remainingLabel: "$1,020",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 1,
    top: "80.7%",
    left: "25.3%",
    width: "4.15rem",
    playerId: "t2",
    playerEmoji: "🐼",
    playerName: "Maya",
    isYou: false,
    badge: { tone: "small-blind", text: "SB" },
    externalStatusLabel: "行动中",
    externalStatusToneClass: "seat-pod__status-badge--turn",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "考虑中…", tone: "pending" as const },
    remainingLabel: "$860",
    seatState: "turn" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 2,
    top: "61.7%",
    left: "10.1%",
    width: "4.15rem",
    playerId: "t3",
    playerEmoji: "🦁",
    playerName: "Noah",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "离线中",
    internalStatusToneClass: "seat-pod__status-badge--disconnected",
    actionLabel: null,
    remainingLabel: "$740",
    seatState: "disconnected" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 3,
    top: "38.3%",
    left: "10.1%",
    width: "4.15rem",
    playerId: "t4",
    playerEmoji: "🐙",
    playerName: "Luna",
    isYou: false,
    badge: null,
    externalStatusLabel: "等待中",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "下一手入局", tone: "pending" as const },
    remainingLabel: "$650",
    seatState: "waiting" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 4,
    top: "19.3%",
    left: "25.3%",
    width: "4.15rem",
    playerId: "t5",
    playerEmoji: "🐯",
    playerName: "Jin",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "弃牌",
    internalStatusToneClass: "seat-pod__status-badge--folded",
    actionLabel: { text: "Fold", tone: "pending" as const },
    remainingLabel: "$590",
    seatState: "folded" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 5,
    top: "10%",
    left: "50%",
    width: "4.15rem",
    playerId: "t6",
    playerEmoji: "🦉",
    playerName: "Eve",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "ALL-IN",
    internalStatusToneClass: "seat-pod__status-badge--allin",
    actionLabel: { text: "All-in $12,420", tone: "allin" as const },
    remainingLabel: "$0",
    seatState: "all-in" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 6,
    top: "19.3%",
    left: "74.7%",
    width: "4.15rem",
    playerId: "t7",
    playerEmoji: "🦄",
    playerName: "Ari",
    isYou: false,
    badge: null,
    externalStatusLabel: "已准备",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: null,
    remainingLabel: "$1,340",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 7,
    top: "38.3%",
    left: "89.9%",
    width: "4.15rem",
    playerId: "t8",
    playerEmoji: "🐧",
    playerName: "Ray",
    isYou: false,
    badge: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "跟注 $40", tone: "call" as const },
    remainingLabel: "$900",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 8,
    top: "61.7%",
    left: "89.9%",
    width: "4.15rem",
    playerId: "t9",
    playerEmoji: "🐺",
    playerName: "Cole",
    isYou: false,
    badge: null,
    externalStatusLabel: "离线中",
    externalStatusToneClass: "seat-pod__status-badge--disconnected",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: null,
    remainingLabel: "$510",
    seatState: "default" as const,
    densityClass: "seat-pod--dense",
  },
  {
    slotIndex: 9,
    top: "80.7%",
    left: "74.7%",
    width: "4.15rem",
    playerId: "t10",
    playerEmoji: "🦝",
    playerName: "Bea",
    isYou: false,
    badge: null,
    externalStatusLabel: "等待中",
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "下手入局", tone: "pending" as const },
    remainingLabel: "$780",
    seatState: "waiting" as const,
    densityClass: "seat-pod--dense",
  },
];

const applyPreciseEllipseSeatLayout = (
  seats: SeatOrbitItems,
  {
    radiusXPercent,
    radiusYPercent,
    centerYPercent,
    width,
  }: {
    radiusXPercent: number;
    radiusYPercent: number;
    centerYPercent: number;
    width: string;
  },
) => {
  const anchors = buildEqualArcEllipsePercentAnchors({
    totalSeats: seats.length,
    radiusXPercent,
    radiusYPercent,
    centerYPercent,
  });

  return seats.map((seat, index) => ({
    ...seat,
    left: anchors?.[index]?.left ?? seat.left,
    top: anchors?.[index]?.top ?? seat.top,
    width,
    densityClass: "seat-pod--dense",
  }));
};

const eightHandedDesktopSeatOrbitItems = applyPreciseEllipseSeatLayout(
  eightHandedStatusSeatOrbitItems,
  {
    radiusXPercent: 42.5,
    radiusYPercent: 36.8,
    centerYPercent: 50,
    width: "4.32rem",
  },
);

const tenHandedDesktopSeatOrbitItems = applyPreciseEllipseSeatLayout(
  tenHandedStatusSeatOrbitItems,
  {
    radiusXPercent: 43.2,
    radiusYPercent: 37.4,
    centerYPercent: 50,
    width: "4.08rem",
  },
);

const eightHandedMobilePortraitSeatOrbitItems = applyPreciseEllipseSeatLayout(
  eightHandedStatusSeatOrbitItems,
  {
    radiusXPercent: 41.2,
    radiusYPercent: 36,
    centerYPercent: 50,
    width: "3.88rem",
  },
);

const eightHandedMobileLandscapeSeatOrbitItems = applyPreciseEllipseSeatLayout(
  eightHandedStatusSeatOrbitItems,
  {
    radiusXPercent: 40.8,
    radiusYPercent: 35.2,
    centerYPercent: 49.5,
    width: "3.68rem",
  },
);

const tenHandedMobilePortraitSeatOrbitItems = applyPreciseEllipseSeatLayout(
  tenHandedStatusSeatOrbitItems,
  {
    radiusXPercent: 41.4,
    radiusYPercent: 36.5,
    centerYPercent: 50,
    width: "3.52rem",
  },
);

const tenHandedMobileLandscapeSeatOrbitItems = applyPreciseEllipseSeatLayout(
  tenHandedStatusSeatOrbitItems,
  {
    radiusXPercent: 40.8,
    radiusYPercent: 35.8,
    centerYPercent: 49.5,
    width: "3.28rem",
  },
);

type TableBoardComponentProps = React.ComponentProps<typeof TableBoard>;
type RuntimeOnlyProps =
  | "feltOvalRef"
  | "boardCenterStackRef"
  | "communityLaneRef"
  | "potDropZoneRef"
  | "setSeatNodeRef";
type TableBoardStoryArgs = Omit<TableBoardComponentProps, RuntimeOnlyProps>;
type TableBoardMetaArgs = Partial<TableBoardStoryArgs>;

const runtimeBoardProps: Pick<TableBoardComponentProps, RuntimeOnlyProps> = {
  feltOvalRef,
  boardCenterStackRef,
  communityLaneRef,
  potDropZoneRef,
  setSeatNodeRef: () => {},
};

const renderBoardFrame = ({
  width,
  height,
  args,
}: {
  width: number;
  height?: number;
  args: TableBoardStoryArgs;
}) => (
  <div
    style={{
      width,
      height,
      margin: "0 auto",
      padding: "0.42rem",
      boxSizing: "border-box",
    }}
  >
    <TableBoard {...runtimeBoardProps} {...args} />
  </div>
);

const desktopArgs: TableBoardStoryArgs = {
  communitySlots: boardCards,
  isYourTurn: true,
  isDragOverDropZone: false,
  potLabel: "Pot Center",
  potValue: "$220",
  potHint: "Drag chips to bet",
  potPulse: true,
  seatOrbitItems,
};

const waitingTurnArgs: TableBoardStoryArgs = {
  ...desktopArgs,
  isYourTurn: false,
  potHint: null,
  potPulse: false,
  communitySlots: [{ rank: "9", suit: "spades" }, null, null, null, null],
};

const mobilePortraitArgs: TableBoardStoryArgs = {
  ...desktopArgs,
  seatOrbitItems: mobileSeatOrbitItems,
  isYourTurn: false,
  potHint: null,
  potPulse: false,
  communitySlots: [
    { rank: "A", suit: "spades" },
    { rank: "K", suit: "hearts" },
    { rank: "10", suit: "clubs" },
    { rank: "2", suit: "diamonds" },
    null,
  ],
};

const mobileSmallArgs: TableBoardStoryArgs = {
  ...desktopArgs,
  seatOrbitItems: mobileSeatOrbitItems,
  isYourTurn: false,
  potHint: null,
  potPulse: false,
  communitySlots: [
    { rank: "9", suit: "spades" },
    { rank: "9", suit: "hearts" },
    { rank: "3", suit: "clubs" },
    null,
    null,
  ],
};

const mobileLandscapeArgs: TableBoardStoryArgs = {
  ...desktopArgs,
  seatOrbitItems: mobileLandscapeSeatOrbitItems,
  isYourTurn: false,
  potHint: null,
  potPulse: false,
  communitySlots: [
    { rank: "A", suit: "spades" },
    { rank: "K", suit: "hearts" },
    { rank: "10", suit: "clubs" },
    null,
    null,
  ],
};

const eightHandedShowcaseArgs: TableBoardStoryArgs = {
  ...desktopArgs,
  seatOrbitItems: eightHandedDesktopSeatOrbitItems,
  isYourTurn: false,
  potHint: null,
  potPulse: false,
  potValue: "$480",
  communitySlots: [
    { rank: "Q", suit: "spades" },
    { rank: "10", suit: "diamonds" },
    { rank: "9", suit: "clubs" },
    { rank: "3", suit: "hearts" },
    null,
  ],
};

const tenHandedShowcaseArgs: TableBoardStoryArgs = {
  ...desktopArgs,
  seatOrbitItems: tenHandedDesktopSeatOrbitItems,
  isYourTurn: false,
  potHint: null,
  potPulse: false,
  potValue: "$1,240",
  communitySlots: [
    { rank: "A", suit: "hearts" },
    { rank: "K", suit: "spades" },
    { rank: "J", suit: "diamonds" },
    { rank: "8", suit: "clubs" },
    { rank: "2", suit: "spades" },
  ],
};

const eightHandedMobilePortraitArgs: TableBoardStoryArgs = {
  ...eightHandedShowcaseArgs,
  seatOrbitItems: eightHandedMobilePortraitSeatOrbitItems,
};

const eightHandedMobileLandscapeArgs: TableBoardStoryArgs = {
  ...eightHandedShowcaseArgs,
  seatOrbitItems: eightHandedMobileLandscapeSeatOrbitItems,
};

const tenHandedMobilePortraitArgs: TableBoardStoryArgs = {
  ...tenHandedShowcaseArgs,
  seatOrbitItems: tenHandedMobilePortraitSeatOrbitItems,
};

const tenHandedMobileLandscapeArgs: TableBoardStoryArgs = {
  ...tenHandedShowcaseArgs,
  seatOrbitItems: tenHandedMobileLandscapeSeatOrbitItems,
};

const meta = {
  title: "Poker/TableBoard",
  component: TableBoard as unknown as React.ComponentType<TableBoardMetaArgs>,
  parameters: {
    layout: "centered",
    controls: { disable: true },
    docs: { disable: true },
  },
  render: () => renderBoardFrame({ width: 960, args: desktopArgs }),
} satisfies Meta<TableBoardMetaArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const WaitingTurn: Story = {
  render: () => renderBoardFrame({ width: 960, args: waitingTurnArgs }),
};

export const MobilePortrait393x852: Story = {
  render: () => renderBoardFrame({ width: 393, height: 852, args: mobilePortraitArgs }),
};

export const MobileSmall375x667: Story = {
  render: () => renderBoardFrame({ width: 375, height: 667, args: mobileSmallArgs }),
};

export const MobileLandscape844x390: Story = {
  render: () => renderBoardFrame({ width: 844, height: 390, args: mobileLandscapeArgs }),
};

export const EightHandedStatusShowcase: Story = {
  render: () =>
    renderBoardFrame({
      width: 1024,
      height: 700,
      args: eightHandedShowcaseArgs,
    }),
};

export const TenHandedStatusShowcase: Story = {
  render: () =>
    renderBoardFrame({
      width: 1180,
      height: 760,
      args: tenHandedShowcaseArgs,
    }),
};

export const EightHandedStatusMobilePortrait393x852: Story = {
  render: () =>
    renderBoardFrame({
      width: 393,
      height: 852,
      args: eightHandedMobilePortraitArgs,
    }),
};

export const EightHandedStatusMobileLandscape844x390: Story = {
  render: () =>
    renderBoardFrame({
      width: 844,
      height: 390,
      args: eightHandedMobileLandscapeArgs,
    }),
};

export const TenHandedStatusMobilePortrait393x852: Story = {
  render: () =>
    renderBoardFrame({
      width: 393,
      height: 852,
      args: tenHandedMobilePortraitArgs,
    }),
};

export const TenHandedStatusMobileLandscape844x390: Story = {
  render: () =>
    renderBoardFrame({
      width: 844,
      height: 390,
      args: tenHandedMobileLandscapeArgs,
    }),
};
