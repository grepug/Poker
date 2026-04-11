import { beforeEach, describe, expect, it } from "vitest";
import {
  getCurrentBrowserUrl,
  isIosDevice,
  isSafariOnIos,
  isWeChatInAppBrowser,
} from "./browser-detection";

describe("browser-detection", () => {
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("detects WeChat embedded browser sessions narrowly from the user agent", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.54",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });

    expect(isWeChatInAppBrowser()).toBe(true);
    expect(isIosDevice()).toBe(true);
    expect(isSafariOnIos()).toBe(true);
  });

  it("does not mark non-WeChat iOS Safari as blocked", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });

    expect(isWeChatInAppBrowser()).toBe(false);
    expect(isIosDevice()).toBe(true);
    expect(isSafariOnIos()).toBe(true);
  });

  it("returns the current browser URL when window is available", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "https://poker.example.com/room/ABCD?seat=2",
        },
      },
    });

    expect(getCurrentBrowserUrl()).toBe("https://poker.example.com/room/ABCD?seat=2");
  });
});
