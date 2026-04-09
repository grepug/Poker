import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TableTopBar } from "./table-top-bar";

describe("TableTopBar", () => {
  it("renders the live audio action and joined indicator", () => {
    const html = renderToStaticMarkup(
      React.createElement(TableTopBar, {
        roomTitle: "Room: CR54ZE",
        playerCountLabel: "Players: 2/8",
        ruleVariantLabel: "Standard Rules",
        inviteCopyLabel: "Copy Invite",
        inviteCopyStatus: null,
        inviteCopyStatusTone: null,
        leaveLabel: "Leave",
        settingsLabel: "Settings",
        rulesLabel: "Rules",
        rankingsLabel: "Rankings",
        chatLabel: "Chat",
        liveAudioLabel: "Live Audio",
        liveAudioJoined: true,
        finalResultsLabel: "Final Results",
        startLabel: "Start",
        hiddenHudCopy: {
          potLabel: "Pot: $10",
          chipsLabel: "Your Chips: $990",
          roundLabel: null,
          turnLabel: null,
        },
        isChatPanelOpen: false,
        chatPreview: null,
        showFinalResultsButton: false,
        showStartGameButton: false,
        onCopyInvite: vi.fn(),
        onLeave: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenRules: vi.fn(),
        onOpenRankings: vi.fn(),
        onToggleChat: vi.fn(),
        onOpenLiveAudio: vi.fn(),
        onOpenFinalResults: vi.fn(),
        onStartGame: vi.fn(),
        onOpenChatFromPreview: vi.fn(),
        onDismissPreview: vi.fn(),
      }),
    );

    expect(html).toContain("data-testid=\"open-live-audio-button\"");
    expect(html).toContain("Live Audio");
    expect(html).toContain("data-testid=\"live-audio-joined-indicator\"");
    expect(html).toContain("Rules");
  });
});
