import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TurnActionDock, partitionCompactMobilePresets } from "./turn-action-dock";

const baseProps = {
  callAmount: 40,
  minRaise: 80,
  maxStack: 980,
  trayAmount: 120,
  trayInputValue: "120",
  isDesktopClickBetting: false,
  canStartDrag: true,
  isDragActive: false,
  isYourTurn: true,
  canCheck: true,
  isAutomationMode: false,
  legacyRaiseAmount: 120,
  trayPresetButtons: [
    { key: "call", label: "Call", amount: 40, testId: "chip-load-continue", tone: "call" as const, enabled: true },
    { key: "third-pot", label: "1/3 Pot", amount: 80, testId: "preset-third-pot", tone: "raise" as const, enabled: true },
    { key: "half-pot", label: "1/2 Pot", amount: 120, testId: "preset-half-pot", tone: "raise" as const, enabled: true },
    { key: "pot", label: "Pot", amount: 240, testId: "preset-pot", tone: "raise" as const, enabled: true },
    { key: "min-raise", label: "Min Raise", amount: 160, testId: "chip-load-raise", tone: "raise" as const, enabled: true },
    { key: "all-in", label: "All-In", amount: 980, testId: "chip-load-all-in", tone: "allin" as const, enabled: true },
  ],
  onDragStart: vi.fn(),
  onDragMove: vi.fn(),
  onDragEnd: vi.fn(),
  onSetTrayDirectly: vi.fn(),
  onTrayInputChange: vi.fn(),
  onTrayInputBlur: vi.fn(),
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
  t: (key: string) => key,
};

describe("TurnActionDock", () => {
  it("keeps check beside fold and disables it when checking is illegal", () => {
    const html = renderToStaticMarkup(
      React.createElement(TurnActionDock, {
        ...baseProps,
        canCheck: false,
      }),
    );

    expect(html).toContain('data-testid="action-check"');
    expect(html).toContain("disabled");
    expect(html).toContain('data-testid="action-fold"');
    expect(html).not.toContain('data-testid="action-call"');
  });

  it("renders the expanded preset composer before the custom amount input", () => {
    const html = renderToStaticMarkup(React.createElement(TurnActionDock, baseProps));

    expect(html).toContain("chip-composer-dock__composer-row");
    expect(html).toContain('data-testid="chip-load-continue"');
    expect(html).toContain('data-testid="chip-load-raise"');
    expect(html).toContain('data-testid="preset-third-pot"');
    expect(html).toContain('data-testid="preset-half-pot"');
    expect(html).toContain('data-testid="preset-pot"');
    expect(html).toContain('data-testid="chip-load-all-in"');

    const callIndex = html.indexOf('data-testid="chip-load-continue"');
    const minRaiseIndex = html.indexOf('data-testid="chip-load-raise"');
    const inputIndex = html.indexOf('data-testid="chip-custom-input"');
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(minRaiseIndex).toBeGreaterThan(callIndex);
    expect(inputIndex).toBeGreaterThan(minRaiseIndex);
  });

  it("collapses mobile-only extra raise presets into a raise popover trigger while keeping call and min-raise visible", () => {
    const html = renderToStaticMarkup(
      React.createElement(TurnActionDock, {
        ...baseProps,
        isCompactMobileLayout: true,
      }),
    );

    expect(html).toContain('data-testid="chip-load-continue"');
    expect(html).toContain('data-testid="action-open-raise-menu"');
    expect(html).toContain('data-testid="chip-custom-input"');
    expect(html).not.toContain('data-testid="chip-load-raise"');
    expect(html).not.toContain('data-testid="preset-third-pot"');
    expect(html).not.toContain('data-testid="preset-half-pot"');
    expect(html).not.toContain('data-testid="preset-pot"');
    expect(html).not.toContain('data-testid="chip-load-all-in"');
  });

  it("hides the mobile raise trigger when there are no legal extra raise presets", () => {
    const html = renderToStaticMarkup(
      React.createElement(TurnActionDock, {
        ...baseProps,
        isCompactMobileLayout: true,
        trayPresetButtons: [
          { key: "call", label: "Call", amount: 40, testId: "chip-load-continue", tone: "call" as const, enabled: true },
        ],
      }),
    );

    expect(html).toContain('data-testid="chip-load-continue"');
    expect(html).not.toContain('data-testid="chip-load-raise"');
    expect(html).not.toContain('data-testid="action-open-raise-menu"');
  });

  it("keeps min-bet standalone on compact mobile when there is nothing to call", () => {
    const html = renderToStaticMarkup(
      React.createElement(TurnActionDock, {
        ...baseProps,
        callAmount: 0,
        isCompactMobileLayout: true,
        trayPresetButtons: [
          { key: "min-raise", label: "Min Bet", amount: 80, testId: "chip-load-raise", tone: "raise" as const, enabled: true },
          { key: "third-pot", label: "1/3 Pot", amount: 120, testId: "preset-third-pot", tone: "raise" as const, enabled: true },
          { key: "half-pot", label: "1/2 Pot", amount: 180, testId: "preset-half-pot", tone: "raise" as const, enabled: true },
        ],
      }),
    );

    expect(html).toContain('data-testid="chip-load-raise"');
    expect(html).toContain('data-testid="action-open-raise-menu"');
    expect(html).not.toContain('data-testid="preset-third-pot"');
    expect(html).not.toContain('data-testid="preset-half-pot"');
  });

  it("partitions compact mobile presets so only call or min-bet remain standalone", () => {
    expect(
      partitionCompactMobilePresets(baseProps.trayPresetButtons, 40).standalonePresets.map(
        (preset) => preset.key,
      ),
    ).toEqual(["call"]);
    expect(
      partitionCompactMobilePresets(baseProps.trayPresetButtons, 40).menuPresets.map(
        (preset) => preset.key,
      ),
    ).toEqual(["third-pot", "half-pot", "pot", "min-raise", "all-in"]);

    expect(
      partitionCompactMobilePresets(
        [
          { key: "min-raise", label: "Min Bet", amount: 80, testId: "chip-load-raise", tone: "raise" as const, enabled: true },
          { key: "third-pot", label: "1/3 Pot", amount: 120, testId: "preset-third-pot", tone: "raise" as const, enabled: true },
        ],
        0,
      ).standalonePresets.map((preset) => preset.key),
    ).toEqual(["min-raise"]);
  });
});
