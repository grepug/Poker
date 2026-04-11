import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeatPod } from "./seat-pod";

describe("SeatPod", () => {
  it("renders the bottom-right muted live audio badge with a slashed mic icon", () => {
    const html = renderToStaticMarkup(
      React.createElement(SeatPod, {
        testId: "player-seat-player-1",
        playerEmoji: "🦊",
        playerName: "Alice",
        isYou: false,
        badge: null,
        liveAudioBadge: { kind: "muted", ariaLabel: "Muted" },
        externalStatusLabel: null,
        externalStatusToneClass: "",
        internalStatusLabel: null,
        internalStatusToneClass: "",
        actionLabel: { text: "Raise to $120", tone: "aggressive" },
        remainingLabel: "$980 behind",
        seatState: "default",
        densityClass: "seat-pod--compact",
      }),
    );

    expect(html).toContain("data-testid=\"player-seat-player-1-live-audio-badge\"");
    expect(html).toContain("aria-label=\"Muted\"");
    expect(html).toContain("seat-pod__live-audio-badge--muted");
    expect(html).toContain("lucide-mic-off");
  });
});
