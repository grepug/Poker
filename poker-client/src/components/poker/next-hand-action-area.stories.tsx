import type { Meta, StoryObj } from "@storybook/react-vite";
import { NextHandActionArea } from "@/components/poker/next-hand-action-area";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/NextHandActionArea",
  component: NextHandActionArea,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    mode: "nextHand",
    canReady: true,
    hasReadied: false,
    canEndGame: true,
    canRandomizeSeats: false,
    isRandomizingSeats: false,
    onReady: () => {},
    onOpenEndGameConfirm: () => {},
    onRandomizeSeats: () => {},
    t: storyTranslate,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 760 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NextHandActionArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HostControls: Story = {};

export const WaitingForOthers: Story = {
  args: {
    canReady: true,
    hasReadied: true,
    canEndGame: false,
  },
};

export const PregameHost: Story = {
  args: {
    mode: "pregame",
    canReady: true,
    hasReadied: false,
    canEndGame: false,
    canRandomizeSeats: true,
  },
};
