import { describe, expect, it } from "vitest";
import { getPwaDisplayModeState } from "./pwa-display-mode";

type TestNavigator = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
};

type TestWindowLike = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: TestNavigator;
};

const createWindowLike = ({
  standaloneDisplayMode = false,
  includeMatchMedia = true,
  navigator,
}: {
  standaloneDisplayMode?: boolean;
  includeMatchMedia?: boolean;
  navigator?: TestNavigator;
} = {}): TestWindowLike => ({
  matchMedia: includeMatchMedia
    ? (query: string) => ({
        matches: query === "(display-mode: standalone)" ? standaloneDisplayMode : false,
      })
    : undefined,
  navigator,
});

describe("getPwaDisplayModeState", () => {
  it("marks iPhone standalone mode as an iOS standalone PWA shell", () => {
    expect(
      getPwaDisplayModeState(
        createWindowLike({
          standaloneDisplayMode: true,
          navigator: {
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
            platform: "iPhone",
            maxTouchPoints: 5,
          },
        }),
      ),
    ).toEqual({
      displayMode: "standalone",
      isIosStandalone: true,
    });
  });

  it("falls back to navigator.standalone for legacy installed iOS web apps", () => {
    expect(
      getPwaDisplayModeState(
        createWindowLike({
          navigator: {
            userAgent:
              "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
            platform: "MacIntel",
            maxTouchPoints: 5,
            standalone: true,
          },
        }),
      ),
    ).toEqual({
      displayMode: "standalone",
      isIosStandalone: true,
    });
  });

  it("treats iPad desktop mode as iOS standalone when touch-capable MacIntel is installed", () => {
    expect(
      getPwaDisplayModeState(
        createWindowLike({
          standaloneDisplayMode: true,
          navigator: {
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
            platform: "MacIntel",
            maxTouchPoints: 5,
          },
        }),
      ),
    ).toEqual({
      displayMode: "standalone",
      isIosStandalone: true,
    });
  });

  it("handles missing matchMedia and still falls back to navigator.standalone", () => {
    const legacyIosWindow = createWindowLike({
      includeMatchMedia: false,
      navigator: {
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
        standalone: true,
      },
    });

    expect(() => getPwaDisplayModeState(legacyIosWindow)).not.toThrow();
    expect(getPwaDisplayModeState(legacyIosWindow)).toEqual({
      displayMode: "standalone",
      isIosStandalone: true,
    });
  });

  it("does not treat non-iOS standalone PWAs as iOS standalone shells", () => {
    expect(
      getPwaDisplayModeState(
        createWindowLike({
          standaloneDisplayMode: true,
          navigator: {
            userAgent:
              "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/135.0.0.0 Mobile Safari/537.36",
            platform: "Linux armv8l",
            maxTouchPoints: 5,
          },
        }),
      ),
    ).toEqual({
      displayMode: "standalone",
      isIosStandalone: false,
    });
  });

  it("returns browser mode when the app is not installed", () => {
    expect(
      getPwaDisplayModeState(
        createWindowLike({
          navigator: {
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
            platform: "iPhone",
            maxTouchPoints: 5,
          },
        }),
      ),
    ).toEqual({
      displayMode: "browser",
      isIosStandalone: false,
    });
  });
});
