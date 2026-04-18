import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PokerModalPanel, PokerModalShell } from "./modal-shell";

describe("PokerModalShell", () => {
  it("renders a centered overlay with a viewport-bounded scrolling panel", () => {
    const html = renderToStaticMarkup(
      React.createElement(PokerModalShell, {
        layout: "centered",
        onBackdropClose: vi.fn(),
        testId: "test-modal",
        children: React.createElement(PokerModalPanel, {
          testId: "test-modal-panel",
          ariaLabelledBy: "test-modal-title",
          scrollMode: "panel",
          children: React.createElement("h3", { id: "test-modal-title" }, "Modal title"),
        }),
      }),
    );

    const panelTagMatch = html.match(/<[^>]*data-testid="test-modal-panel"[^>]*>/);

    expect(html).toContain("data-testid=\"test-modal\"");
    expect(panelTagMatch).not.toBeNull();
    expect(panelTagMatch?.[0]).toContain("max-h-[calc(100vh-2rem)]");
    expect(panelTagMatch?.[0]).toContain("overflow-y-auto");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="test-modal-title"');
  });

  it("supports viewport-bounded panels with inner content scroll regions", () => {
    const html = renderToStaticMarkup(
      React.createElement(PokerModalShell, {
        layout: "centered",
        testId: "inner-scroll-modal",
        children: React.createElement(PokerModalPanel, {
          testId: "inner-scroll-modal-panel",
          ariaLabelledBy: "inner-scroll-modal-title",
          scrollMode: "content",
          children: React.createElement("div", null, [
            React.createElement("h3", { id: "inner-scroll-modal-title", key: "title" }, "Rankings"),
            React.createElement(
              "div",
              {
                className: "min-h-0 flex-1 overflow-y-auto",
                "data-testid": "inner-scroll-region",
                key: "content",
              },
              "Scrollable content",
            ),
          ]),
        }),
      }),
    );

    const panelTagMatch = html.match(/<[^>]*data-testid="inner-scroll-modal-panel"[^>]*>/);

    expect(panelTagMatch).not.toBeNull();
    expect(panelTagMatch?.[0]).toContain("max-h-[calc(100vh-2rem)]");
    expect(panelTagMatch?.[0]).not.toContain("overflow-y-auto");
    expect(html).toContain("data-testid=\"inner-scroll-region\"");
  });

  it("uses a scrollable page overlay and only closes on backdrop clicks", () => {
    const onBackdropClose = vi.fn();
    const element = PokerModalShell({
      layout: "page",
      onBackdropClose,
      testId: "page-modal",
      children: React.createElement("div", null, "Page content"),
    }) as React.ReactElement<{
      className: string;
      onClick: (event: { target: unknown; currentTarget: unknown }) => void;
    }>;

    expect(element.props.className).toContain("overflow-y-auto");

    const overlayTarget = { id: "overlay" };
    element.props.onClick({
      target: overlayTarget,
      currentTarget: overlayTarget,
    });
    expect(onBackdropClose).toHaveBeenCalledTimes(1);

    const innerTarget = { id: "inner" };
    element.props.onClick({
      target: innerTarget,
      currentTarget: overlayTarget,
    });
    expect(onBackdropClose).toHaveBeenCalledTimes(1);
  });
});
