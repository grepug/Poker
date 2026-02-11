import type { Meta, StoryObj } from "@storybook/react-vite";
import { SeatPod } from "@/components/poker/seat-pod";

const meta = {
  title: "Poker/SeatPod",
  component: SeatPod,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof SeatPod>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    testId: "player-seat-1",
    playerEmoji: "🦊",
    playerName: "Kai",
    isYou: true,
    roleIcon: "dealer",
    roleLabel: "D",
    externalStatusLabel: null,
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "seat-pod__status-badge--waiting",
    actionLabel: { text: "Bet $40", tone: "aggressive" },
    remainingLabel: "$960 behind",
    seatState: "turn",
    densityClass: "seat-pod--spacious",
  },
};

export const Waiting: Story = {
  args: {
    ...Default.args,
    roleIcon: null,
    roleLabel: null,
    externalStatusLabel: "WAITING",
    actionLabel: { text: "Waiting for next hand", tone: "pending" },
    seatState: "waiting",
    densityClass: "seat-pod--compact",
  },
};
