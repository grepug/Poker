import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalizationProvider } from "@/contexts/LocalizationContext";
import { WeChatBrowserGate } from "./WeChatBrowserGate";

describe("WeChatBrowserGate", () => {
  it("renders two continuation methods and keeps the current invite URL visible", () => {
    const html = renderToStaticMarkup(
      React.createElement(LocalizationProvider, {
        children: React.createElement(WeChatBrowserGate, {
          currentUrl: "https://poker.example.com/room/ABCD",
        }),
      }),
    );

    expect(html).toContain("data-testid=\"wechat-browser-gate\"");
    expect(html).toContain("Method 1: Copy this link and open it in your browser");
    expect(html).toContain("Method 2: Open the same link from WeChat&#x27;s menu");
    expect(html).toContain("Top-right More -&gt; 用默认浏览器打开");
    expect(html).toContain("https://poker.example.com/room/ABCD");
    expect(html).toContain("data-testid=\"wechat-browser-copy-link\"");
  });

  it("uses an overflow-safe fullscreen shell for tall mobile content", () => {
    const html = renderToStaticMarkup(
      React.createElement(LocalizationProvider, {
        children: React.createElement(WeChatBrowserGate, {
          currentUrl: "https://poker.example.com/room/ABCD",
        }),
      }),
    );

    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("max-h-[calc(100vh-2rem)]");
    expect(html).toContain("data-testid=\"wechat-browser-gate-panel\"");
  });
});
