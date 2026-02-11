import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card as PokerCard } from "poker-types";
import { TableBoard } from "@/components/poker/table-board";

const boardCards: Array<PokerCard | null> = [
  { rank: "A", suit: "spades" },
  { rank: "K", suit: "hearts" },
  { rank: "10", suit: "clubs" },
  null,
  null,
];
const feltOvalRef = React.createRef<HTMLDivElement>();
const potDropZoneRef = React.createRef<HTMLDivElement>();

const seatOrbitItems = [
  {
    slotIndex: 0,
    top: "86%",
    left: "50%",
    width: "clamp(3rem, 10.7vw, 3.7rem)",
    playerId: "p1",
    playerEmoji: "🦊",
    playerName: "Kai",
    isYou: true,
    roleIcon: "dealer" as const,
    roleLabel: "D",
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: null,
    internalStatusToneClass: "",
    actionLabel: { text: "Raise $80", tone: "aggressive" as const },
    remainingLabel: "$920",
    seatState: "default" as const,
    densityClass: "seat-pod--compact",
  },
  {
    slotIndex: 1,
    top: "22%",
    left: "28%",
    width: "clamp(3rem, 10.7vw, 3.7rem)",
    playerId: "p2",
    playerEmoji: "🐼",
    playerName: "Maya",
    isYou: false,
    roleIcon: "small-blind" as const,
    roleLabel: "SB",
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
    left: "72%",
    width: "clamp(3rem, 10.7vw, 3.7rem)",
    playerId: "p3",
    playerEmoji: "🦁",
    playerName: "Noah",
    isYou: false,
    roleIcon: null,
    roleLabel: null,
    externalStatusLabel: null,
    externalStatusToneClass: "",
    internalStatusLabel: "Folded",
    internalStatusToneClass: "seat-pod__status-badge--folded",
    actionLabel: { text: "Fold", tone: "pending" as const },
    remainingLabel: "$480",
    seatState: "folded" as const,
    densityClass: "seat-pod--compact",
  },
];

const meta = {
  title: "Poker/TableBoard",
  component: TableBoard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    feltOvalRef,
    potDropZoneRef,
    setSeatNodeRef: () => {},
    communitySlots: boardCards,
    isYourTurn: true,
    isDragOverDropZone: false,
    potLabel: "Pot Center",
    potValue: "$220",
    potHint: "Drag chips to bet",
    potPulse: true,
    seatOrbitItems,
  },
  render: (args) => {
    return (
      <div style={{ width: 960 }}>
        <TableBoard {...args} />
      </div>
    );
  },
} satisfies Meta<typeof TableBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const WaitingTurn: Story = {
  args: {
    isYourTurn: false,
    isDragOverDropZone: false,
    potHint: null,
    potPulse: false,
    communitySlots: [
      { rank: "9", suit: "spades" },
      null,
      null,
      null,
      null,
    ],
  },
};
