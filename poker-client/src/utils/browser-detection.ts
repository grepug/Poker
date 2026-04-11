export const isIosDevice = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent ?? "";
  const isIphoneFamily = /iPhone|iPad|iPod/i.test(userAgent);
  const isIpadDesktopMode =
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return isIphoneFamily || isIpadDesktopMode;
};

export const isSafariOnIos = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent ?? "";
  const hasSafariTokens = /Version\/.*Safari\//i.test(userAgent);
  const hasOtherBrowserToken =
    /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|MicroMessenger/i.test(userAgent);
  return isIosDevice() && hasSafariTokens && !hasOtherBrowserToken;
};

export const isWeChatInAppBrowser = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent ?? "";
  return /MicroMessenger/i.test(userAgent);
};

export const getCurrentBrowserUrl = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.href;
};
