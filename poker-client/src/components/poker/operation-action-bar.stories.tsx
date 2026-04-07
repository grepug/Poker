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
    runCountCanChoose: true,
    runCountHasChosenTwice: false,
    runCountReadyCount: 1,
    runCountTotalCount: 2,
    runCountWaitingPlayerNames: ["Maya"],
    isResultRevealStep: false,
    canRevealNextStreet: true,
    hasRevealedNextStreet: false,
    canShowMyHand: true,
    hasShownMyHand: false,
    canFoldMyHand: true,
    hasFoldedMyHand: false,
    showdownIsDecisionTurn: true,
    showdownWaitingPlayerName: null,
    showdownIsForcedRevealTurn: false,
    onChooseRunOnce: () => {},
    onChooseRunTwice: () => {},
    onRevealNextStreet: () => {},
    onShowMyHand: () => {},
    onFoldMyHand: () => {},
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

export const RunCountDecision: Story = {
  args: {
    mode: "runCount",
  },
};

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
