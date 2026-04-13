import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HandResultsModal } from "./hand-results-modal";
import { storyTranslate } from "./storybook-fixtures";

describe("HandResultsModal", () => {
  it("keeps close controls and footer content inside the dialog subtree", () => {
    const html = renderToStaticMarkup(
      React.createElement(HandResultsModal, {
        ariaLabel: "Hand results",
        footer: React.createElement(
          "div",
          {
            "data-testid": "hand-results-footer",
          },
          "Footer",
        ),
        onClose: vi.fn(),
        t: storyTranslate,
        children: React.createElement("div", null, "Body"),
      }),
    );

    const panelMarkup = html.match(
      /<section[^>]*data-testid="hand-results-panel"[\s\S]*<\/section>/,
    )?.[0];

    expect(panelMarkup).toBeDefined();
    expect(panelMarkup).toContain('data-testid="close-hand-results-button"');
    expect(panelMarkup).toContain('data-testid="hand-results-footer"');
  });
});
