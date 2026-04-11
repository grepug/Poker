import React from "react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveAudioPopover } from "./live-audio-popover";

describe("LiveAudioPopover", () => {
  it("renders the compact popover shell instead of the old full-screen modal", () => {
    const anchorRef = createRef<HTMLButtonElement>();
    const html = renderToStaticMarkup(
      React.createElement(LiveAudioPopover, {
        anchorRef,
        isOpen: true,
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
        joinPopoverTitle: "Join Table Audio",
        controlPopoverTitle: "Audio Controls",
        closeLabel: "Close",
        error: null,
        available: true,
        isConfigLoaded: true,
        isConnecting: false,
        isJoined: false,
        isMuted: false,
        isAudioPlaybackBlocked: false,
        isReconnecting: false,
        onJoin: vi.fn(),
        onLeave: vi.fn(),
        onMute: vi.fn(),
        onUnmute: vi.fn(),
        onEnableAudio: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain("data-testid=\"live-audio-popover\"");
    expect(html).toContain("Join Table Audio");
    expect(html).toContain("Join Audio");
    expect(html).toContain("aria-label=\"Close\"");
    expect(html).not.toContain("data-testid=\"live-audio-modal\"");
  });
});
