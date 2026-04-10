import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChipComposerDock } from "@/components/poker/chip-composer-dock";
import { TurnActionDock } from "@/components/poker/turn-action-dock";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const facingBetPresets = [
  {
    key: "call",
    label: "Call",
    amount: 40,
    testId: "chip-load-continue",
    tone: "call" as const,
    enabled: true,
  },
  {
    key: "min-raise",
    label: "Min Raise",
    amount: 120,
    testId: "chip-load-raise",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "third-pot",
    label: "1/3 Pot",
    amount: 173,
    testId: "preset-third-pot",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "half-pot",
    label: "1/2 Pot",
    amount: 240,
    testId: "preset-half-pot",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "pot",
    label: "Pot",
    amount: 440,
    testId: "preset-pot",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "all-in",
    label: "All-in",
    amount: 980,
    testId: "chip-load-all-in",
    tone: "allin" as const,
    enabled: true,
  },
] satisfies NonNullable<ComponentProps<typeof TurnActionDock>["trayPresetButtons"]>;

const noBetPresets = [
  {
    key: "min-raise",
    label: "Min Bet",
    amount: 80,
    testId: "chip-load-raise",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "third-pot",
    label: "1/3 Pot",
    amount: 120,
    testId: "preset-third-pot",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "half-pot",
    label: "1/2 Pot",
    amount: 180,
    testId: "preset-half-pot",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "pot",
    label: "Pot",
    amount: 360,
    testId: "preset-pot",
    tone: "raise" as const,
    enabled: true,
  },
  {
    key: "all-in",
    label: "All-in",
    amount: 980,
    testId: "chip-load-all-in",
    tone: "allin" as const,
    enabled: true,
  },
] satisfies NonNullable<ComponentProps<typeof TurnActionDock>["trayPresetButtons"]>;

const meta = {
  title: "Poker/TurnActionDock",
  component: TurnActionDock,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    callAmount: 40,
    isOpeningBetAction: false,
    minRaise: 80,
    maxStack: 980,
    trayAmount: 120,
    trayInputValue: "120",
    mobileChipDraftValue: "120",
    showMobileChipPopover: false,
    isDesktopClickBetting: true,
    isCompactMobileLayout: false,
    canStartDrag: true,
    isDragActive: false,
    isYourTurn: true,
    canCheck: false,
    isAutomationMode: false,
    legacyRaiseAmount: 120,
    trayPresetButtons: facingBetPresets,
    onDragStart: () => {},
    onDragMove: () => {},
    onDragEnd: () => {},
    onSetTrayDirectly: () => {},
    onTrayInputChange: () => {},
    onTrayInputBlur: () => {},
    onOpenMobileChipPopover: () => {},
    onCloseMobileChipPopover: () => {},
    onMobileChipDigit: () => {},
    onMobileChipBackspace: () => {},
    onMobileChipClearDraft: () => {},
    onMobileChipConfirm: () => {},
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
    <div className="table-shell table-shell--desktop-two-column table-shell--desktop-turn-dock">
      <div className="table-shell__desktop-layout">
        <div className="table-shell__game-column">
          <div className="desktop-dock-cluster" style={{ padding: "1rem", minHeight: "18rem" }}>
            <div aria-hidden="true" style={{ width: "11rem", minHeight: "1px" }} />
            <div className="desktop-dock-cluster__anchor" style={{ gridColumn: "2" }}>
              <ChipComposerDock className="chip-composer-dock--desktop-main">
                <TurnActionDock {...args} />
              </ChipComposerDock>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
} satisfies Meta<typeof TurnActionDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const CheckDisabledFacingBet: Story = {};

export const CheckAvailable: Story = {
  args: {
    canCheck: true,
    callAmount: 0,
    isOpeningBetAction: true,
    trayPresetButtons: noBetPresets,
  },
};

export const MobileFacingBet: Story = {
  args: {
    isDesktopClickBetting: false,
    isCompactMobileLayout: true,
    trayPresetButtons: facingBetPresets,
  },
  render: (args) => (
    <div style={{ width: 390 }}>
      <ChipComposerDock>
        <TurnActionDock {...args} />
      </ChipComposerDock>
    </div>
  ),
};

export const MobilePopover: Story = {
  args: {
    isDesktopClickBetting: false,
    isCompactMobileLayout: true,
    showMobileChipPopover: true,
    mobileChipDraftValue: "240",
  },
  render: (args) => (
    <div style={{ width: 390 }}>
      <ChipComposerDock>
        <TurnActionDock {...args} />
      </ChipComposerDock>
    </div>
  ),
};
