import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LocalizationProvider } from "@/contexts/LocalizationContext";
import { AppShell } from "./App";

describe("AppShell", () => {
  it("renders the WeChat browser gate before the app routes when blocked", () => {
    const html = renderToStaticMarkup(
      React.createElement(LocalizationProvider, {
        children: React.createElement(MemoryRouter, {
          initialEntries: ["/room/ABCD"],
          children: React.createElement(AppShell, {
            blockWeChatBrowser: true,
            currentUrl: "https://poker.example.com/room/ABCD",
          }),
        }),
      }),
    );

    expect(html).toContain("data-testid=\"wechat-browser-gate\"");
    expect(html).toContain("https://poker.example.com/room/ABCD");
    expect(html).not.toContain("data-testid=\"auth-page\"");
  });

  it("keeps the normal app shell for supported browsers", () => {
    const html = renderToStaticMarkup(
      React.createElement(LocalizationProvider, {
        children: React.createElement(MemoryRouter, {
          initialEntries: ["/room/ABCD"],
          children: React.createElement(AppShell, {
            blockWeChatBrowser: false,
          }),
        }),
      }),
    );

    expect(html).toContain("Loading...");
    expect(html).not.toContain("data-testid=\"wechat-browser-gate\"");
  });
});
