import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChipComposerDock } from "@/components/poker/chip-composer-dock";
import { OperationActionBar } from "@/components/poker/operation-action-bar";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/OperationActionBar",
  component: OperationActionBar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    mode: "showdown",
    isAutomationMode: false,
    isResultRevealStep: false,
    canRevealNextStreet: true,
    hasRevealedNextStreet: false,
    canShowMyHand: true,
    hasShownMyHand: false,
    canMuckMyHand: true,
    hasMuckedMyHand: false,
    showdownIsDecisionTurn: true,
    showdownWaitingPlayerName: null,
    showdownIsForcedRevealTurn: false,
    onRevealNextStreet: () => {},
    onShowMyHand: () => {},
    onMuckMyHand: () => {},
    t: storyTranslate,
  },
  render: (args) => (
    <div style={{ width: 860 }}>
      <ChipComposerDock className="chip-composer-dock--operation">
        <OperationActionBar {...args} />
      </ChipComposerDock>
    </div>
  ),
} satisfies Meta<typeof OperationActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showdown: Story = {};

export const RevealNextStreet: Story = {
  args: {
    mode: "streetReveal",
  },
};

export const RevealResult: Story = {
  args: {
    mode: "streetReveal",
    isResultRevealStep: true,
  },
};
