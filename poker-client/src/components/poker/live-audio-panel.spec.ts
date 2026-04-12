import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveAudioPanel } from "./live-audio-panel";

describe("LiveAudioPanel", () => {
  it("renders compact controls without the old participant roster", () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveAudioPanel, {
        title: "Realtime Audio",
        subtitle: "Join the room audio",
        joinLabel: "Join",
        leaveLabel: "Leave",
        muteLabel: "Mute",
        unmuteLabel: "Unmute",
        enableAudioLabel: "Enable Audio",
        connectingLabel: "Connecting",
        connectedLabel: "Connected",
        reconnectingLabel: "Reconnecting",
        mutedLabel: "Muted",
        unavailableLabel: "Unavailable",
        error: null,
        available: true,
        isConfigLoaded: true,
        isConnecting: false,
        isJoined: true,
        isMuted: true,
        isAudioPlaybackBlocked: false,
        isReconnecting: false,
        onJoin: vi.fn(),
        onLeave: vi.fn(),
        onMute: vi.fn(),
        onUnmute: vi.fn(),
        onEnableAudio: vi.fn(),
      }),
    );

    expect(html).toContain("data-testid=\"live-audio-panel\"");
    expect(html).toContain("data-testid=\"live-audio-mute-button\"");
    expect(html).not.toContain("data-testid=\"live-audio-participant-roster\"");
    expect(html).not.toContain("Alice （你）");
  });
});
