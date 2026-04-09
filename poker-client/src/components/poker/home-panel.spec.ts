import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomePanel } from "./home-panel";

describe("HomePanel", () => {
  it("keeps room controls visible without rendering duplicated profile editors", () => {
    const html = renderToStaticMarkup(
      React.createElement(HomePanel, {
        connected: true,
        isRecoveringSession: false,
        isJoining: false,
        inferredRoomId: "",
        effectiveRoomId: "",
        feedback: null,
        lastError: null,
        useShortDeckRules: false,
        maxPlayers: 10,
        t: (key: string) => key,
        onUseShortDeckRulesChange: vi.fn(),
        onMaxPlayersChange: vi.fn(),
        onCreateRoom: vi.fn(),
        onEnableJoinMode: vi.fn(),
        onRoomIdChange: vi.fn(),
        onJoinRoom: vi.fn(),
        onBack: vi.fn(),
      }),
    );

    expect(html).toContain("data-testid=\"connection-status\"");
    expect(html).toContain("data-testid=\"max-players-select\"");
    expect(html).toContain("data-testid=\"create-room-button\"");
    expect(html).toContain("data-testid=\"join-toggle-button\"");
    expect(html).not.toContain("data-testid=\"name-input\"");
    expect(html).not.toContain("data-testid=\"emoji-select\"");
    expect(html).not.toContain("data-testid=\"emoji-randomize-button\"");
  });
});
