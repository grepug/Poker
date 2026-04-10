import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RankingsModal } from "./rankings-modal";
import { storyTranslate } from "./storybook-fixtures";

const basePlayerRankings = [
  {
    id: "p1",
    name: "Kai",
    tableStack: 1240,
    totalBuyIn: 1000,
    net: 240,
  },
  {
    id: "p2",
    name: "Maya",
    tableStack: 980,
    totalBuyIn: 1000,
    net: -20,
  },
];

describe("RankingsModal", () => {
  it("renders a viewport-bounded panel with a dedicated scroll region for standings", () => {
    const html = renderToStaticMarkup(
      React.createElement(RankingsModal, {
        playerRankings: basePlayerRankings,
        currentPlayerId: "p1",
        onClose: vi.fn(),
        t: storyTranslate,
      }),
    );

    expect(html).toContain('data-testid="rankings-modal-panel"');
    expect(html).toContain("max-h-[calc(100vh-2rem)]");
    expect(html).toContain('data-testid="rankings-modal-scroll-region"');
    expect(html).toContain("overflow-y-auto");
  });
});
