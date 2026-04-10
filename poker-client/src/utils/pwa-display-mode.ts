export type PwaDisplayModeState = {
  displayMode: "browser" | "standalone";
  isIosStandalone: boolean;
};

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
};

type WindowLike = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: NavigatorLike;
};

const isIosNavigator = (navigatorLike?: NavigatorLike): boolean => {
  if (!navigatorLike) {
    return false;
  }

  const userAgent = navigatorLike.userAgent ?? "";
  const isIphoneFamily = /iPhone|iPad|iPod/i.test(userAgent);
  const isIpadDesktopMode =
    navigatorLike.platform === "MacIntel" &&
    typeof navigatorLike.maxTouchPoints === "number" &&
    navigatorLike.maxTouchPoints > 1;

  return isIphoneFamily || isIpadDesktopMode;
};

const isStandaloneDisplayMode = (windowLike?: WindowLike): boolean => {
  if (!windowLike) {
    return false;
  }

  return (
    windowLike.matchMedia?.("(display-mode: standalone)").matches === true ||
    Boolean(windowLike.navigator?.standalone)
  );
};

export const getPwaDisplayModeState = (windowLike?: WindowLike): PwaDisplayModeState => {
  const isStandalone = isStandaloneDisplayMode(windowLike);

  return {
    displayMode: isStandalone ? "standalone" : "browser",
    isIosStandalone: isStandalone && isIosNavigator(windowLike?.navigator),
  };
};
