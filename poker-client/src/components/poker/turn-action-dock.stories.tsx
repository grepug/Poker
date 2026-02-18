import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChipComposerDock } from "@/components/poker/chip-composer-dock";
import { TurnActionDock } from "@/components/poker/turn-action-dock";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/TurnActionDock",
  component: TurnActionDock,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    callAmount: 40,
    minRaise: 80,
    maxStack: 980,
    trayAmount: 120,
    trayInputValue: "120",
    canStartDrag: true,
    isDragActive: false,
    isYourTurn: true,
    canCheck: false,
    isAutomationMode: true,
    legacyRaiseAmount: 120,
    trayPresetButtons: [
      { key: "call", label: "Call", amount: 40, testId: "preset-call", tone: "call", enabled: true },
      { key: "minRaise", label: "Min Raise", amount: 80, testId: "preset-min-raise", tone: "raise", enabled: true },
      { key: "allIn", label: "All-in", amount: 980, testId: "preset-all-in", tone: "allin", enabled: true },
    ],
    onDragStart: () => {},
    onDragMove: () => {},
    onDragEnd: () => {},
    onSetTrayDirectly: () => {},
    onTrayInputChange: () => {},
    onTrayInputBlur: () => {},
    onClearTray: () => {},
    onQuickDecisionAction: () => {},
    quickConfirmAction: null,
    onQuickConfirmDismiss: () => {},
    onQuickConfirmAccept: () => {},
    onLegacyAction: () => {},
    onLegacyRaiseAmountChange: () => {},
    t: storyTranslate,
  },
  render: (args) => (
    <div style={{ width: 760 }}>
      <ChipComposerDock>
        <TurnActionDock {...args} />
      </ChipComposerDock>
    </div>
  ),
} satisfies Meta<typeof TurnActionDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const CheckAvailable: Story = {
  args: {
    canCheck: true,
    isAutomationMode: false,
    callAmount: 0,
    trayPresetButtons: [
      { key: "half", label: "1/2 Pot", amount: 60, testId: "preset-half-pot", tone: "raise", enabled: true },
      { key: "pot", label: "Pot", amount: 120, testId: "preset-pot", tone: "raise", enabled: true },
      { key: "allIn", label: "All-in", amount: 980, testId: "preset-all-in", tone: "allin", enabled: true },
    ],
  },
};
