import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TurnActionDock } from "./turn-action-dock";
import { storyTranslate } from "./storybook-fixtures";

const baseProps = {
  callAmount: 40,
  minRaise: 80,
  maxStack: 980,
  trayAmount: 120,
  trayInputValue: "120",
  mobileChipDraftValue: "120",
  showMobileChipPopover: false,
  isDesktopClickBetting: true,
  canStartDrag: true,
  isDragActive: false,
  isYourTurn: true,
  canCheck: false,
  isAutomationMode: false,
  legacyRaiseAmount: 120,
  trayPresetButtons: [
    { key: "call", label: "Call", amount: 40, testId: "preset-call", tone: "call" as const, enabled: true },
    { key: "raise", label: "Raise", amount: 80, testId: "preset-raise", tone: "raise" as const, enabled: true },
    { key: "allin", label: "All-in", amount: 980, testId: "preset-all-in", tone: "allin" as const, enabled: true },
  ],
  onDragStart: vi.fn(),
  onDragMove: vi.fn(),
  onDragEnd: vi.fn(),
  onSetTrayDirectly: vi.fn(),
  onTrayInputChange: vi.fn(),
  onTrayInputBlur: vi.fn(),
  onOpenMobileChipPopover: vi.fn(),
  onCloseMobileChipPopover: vi.fn(),
  onMobileChipDigit: vi.fn(),
  onMobileChipBackspace: vi.fn(),
  onMobileChipClearDraft: vi.fn(),
  onMobileChipConfirm: vi.fn(),
  onClearTray: vi.fn(),
  onSubmitTray: vi.fn(),
  onQuickDecisionAction: vi.fn(),
  quickConfirmAction: null,
  onQuickConfirmDismiss: vi.fn(),
  onQuickConfirmAccept: vi.fn(),
  traySubmitLabel: null,
  showTrayConfirm: false,
  onTrayConfirmDismiss: vi.fn(),
  onTrayConfirmAccept: vi.fn(),
  onLegacyAction: vi.fn(),
  onLegacyRaiseAmountChange: vi.fn(),
  t: storyTranslate,
};

describe("TurnActionDock", () => {
  it("keeps the inline custom input on desktop", () => {
    const html = renderToStaticMarkup(React.createElement(TurnActionDock, baseProps));

    expect(html).toContain("data-testid=\"chip-custom-input\"");
    expect(html).not.toContain("data-testid=\"chip-mobile-input-trigger\"");
  });

  it("renders the mobile trigger and popover instead of the inline input", () => {
    const html = renderToStaticMarkup(
      React.createElement(TurnActionDock, {
        ...baseProps,
        isDesktopClickBetting: false,
        showMobileChipPopover: true,
        mobileChipDraftValue: "240",
      }),
    );

    expect(html).not.toContain("data-testid=\"chip-custom-input\"");
    expect(html).toContain("data-testid=\"chip-mobile-input-trigger\"");
    expect(html).toContain("data-testid=\"chip-mobile-input-popover\"");
    expect(html).toContain("data-testid=\"chip-mobile-popover-confirm\"");
  });
});
