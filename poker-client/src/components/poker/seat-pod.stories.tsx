import type { Meta, StoryObj } from "@storybook/react-vite";
import { SeatPod } from "@/components/poker/seat-pod";

const meta = {
  title: "Poker/SeatPod",
  component: SeatPod,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  render: (args) => (
    <div
      style={{
        width: "min(22rem, 72vw)",
        maxWidth: "12rem",
        padding: "1.3rem",
        borderRadius: "1.2rem",
        background:
          "radial-gradient(circle at 25% 14%, rgba(16, 185, 129, 0.2), transparent 42%), linear-gradient(145deg, #0b2f22, #042118 62%, #03130d)",
        boxShadow: "inset 0 0 0 1px rgba(16, 185, 129, 0.2), 0 18px 28px rgba(2, 6, 23, 0.42)",
      }}
    >
      <SeatPod {...args} />
    </div>
  ),
} satisfies Meta<typeof SeatPod>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TurnSeat: Story = {
  args: {
    testId: "player-seat-1",
    playerEmoji: "🦊",
    playerName: "Kai",
    isYou: true,
    roleIcon: "dealer",
    roleLabel: "BTN",
    positionLabel: null,
    externalStatusLabel: null,
    externalStatusToneClass: "seat-pod__status-badge--waiting",
    internalStatusLabel: null,
    internalStatusToneClass: "seat-pod__status-badge--waiting",
    actionLabel: { text: "Raise to $120", tone: "aggressive" },
    remainingLabel: "$960 behind",
    seatState: "turn",
    densityClass: "seat-pod--spacious",
  },
};

export const WaitingSeat: Story = {
  args: {
    ...TurnSeat.args,
    roleIcon: null,
    roleLabel: null,
    externalStatusLabel: "WAITING",
    actionLabel: { text: "Waiting for next hand", tone: "pending" },
    seatState: "waiting",
    densityClass: "seat-pod--compact",
  },
};

export const FoldedSeat: Story = {
  args: {
    ...TurnSeat.args,
    isYou: false,
    playerEmoji: "🦁",
    playerName: "Noah",
    roleIcon: null,
    roleLabel: null,
    positionLabel: "BB",
    externalStatusLabel: null,
    actionLabel: { text: "Fold", tone: "pending" },
    internalStatusLabel: "FOLDED",
    internalStatusToneClass: "seat-pod__status-badge--folded",
    remainingLabel: "$540",
    seatState: "folded",
    densityClass: "seat-pod--compact",
  },
};
