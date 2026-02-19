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
    canReadyNextHand: true,
    hasReadiedNextHand: false,
    canEndGame: true,
    onReadyNextHand: () => {},
    onOpenEndGameConfirm: () => {},
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
    canReadyNextHand: true,
    hasReadiedNextHand: true,
    canEndGame: false,
  },
};
