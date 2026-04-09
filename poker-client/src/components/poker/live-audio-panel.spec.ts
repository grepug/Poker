import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveAudioPanel } from "./live-audio-panel";

describe("LiveAudioPanel", () => {
  it("renders the local participant suffix from props instead of hard-coding English copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveAudioPanel, {
        title: "Realtime Audio",
        subtitle: "Join the room audio",
        joinLabel: "Join",
        leaveLabel: "Leave",
        muteLabel: "Mute",
        unmuteLabel: "Unmute",
        connectingLabel: "Connecting",
        connectedLabel: "Connected",
        reconnectingLabel: "Reconnecting",
        mutedLabel: "Muted",
        unavailableLabel: "Unavailable",
        rosterLabel: "Roster",
        localParticipantLabel: "（你）",
        error: null,
        available: true,
        isConfigLoaded: true,
        isConnecting: false,
        isJoined: true,
        isMuted: true,
        isReconnecting: false,
        participants: [
          {
            identity: "user-1:player-1",
            displayName: "Alice",
            avatarEmoji: "🦊",
            isLocal: true,
            isMuted: true,
            isSpeaking: false,
          },
        ],
        onJoin: vi.fn(),
        onLeave: vi.fn(),
        onMute: vi.fn(),
        onUnmute: vi.fn(),
      }),
    );

    expect(html).toContain("Alice （你）");
    expect(html).not.toContain("(You)");
  });
});
