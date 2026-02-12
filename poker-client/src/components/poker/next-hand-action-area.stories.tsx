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
    waitingForOthersNextHand: false,
    showNextStreetActionArea: false,
    isResultRevealStep: false,
    canRevealNextStreet: true,
    hasRevealedNextStreet: false,
    onReadyNextHand: () => {},
    onOpenEndGameConfirm: () => {},
    onRevealNextStreet: () => {},
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

export const WaitingForHost: Story = {
  args: {
    canReadyNextHand: false,
    waitingForOthersNextHand: true,
  },
};

export const RevealNextStreet: Story = {
  args: {
    canReadyNextHand: false,
    showNextStreetActionArea: true,
    isResultRevealStep: false,
  },
};
