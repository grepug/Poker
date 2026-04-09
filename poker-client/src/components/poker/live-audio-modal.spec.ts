import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveAudioModal } from "./live-audio-modal";

describe("LiveAudioModal", () => {
  it("renders the live audio modal chrome and panel content", () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveAudioModal, {
        title: "Live Audio",
        subtitle: "Join the room audio and hear the table in real time.",
        joinLabel: "Join Audio",
        leaveLabel: "Leave Audio",
        muteLabel: "Mute",
        unmuteLabel: "Unmute",
        enableAudioLabel: "Enable Audio",
        connectingLabel: "Connecting",
        connectedLabel: "Connected",
        reconnectingLabel: "Reconnecting",
        mutedLabel: "Muted",
        unavailableLabel: "Unavailable",
        rosterLabel: "Audio roster",
        localParticipantLabel: "(You)",
        closeLabel: "Close",
        modalTitle: "Table Audio",
        modalSubtitle: "Voice controls and roster live here.",
        error: null,
        available: true,
        isConfigLoaded: true,
        isConnecting: false,
        isJoined: false,
        isMuted: true,
        isAudioPlaybackBlocked: false,
        isReconnecting: false,
        participants: [],
        onJoin: vi.fn(),
        onLeave: vi.fn(),
        onMute: vi.fn(),
        onUnmute: vi.fn(),
        onEnableAudio: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain("data-testid=\"live-audio-modal\"");
    expect(html).toContain("Table Audio");
    expect(html).toContain("Voice controls and roster live here.");
    expect(html).toContain("Close");
    expect(html).toContain("Join Audio");
  });
});
