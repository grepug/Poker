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

export type PasskeySupportIssue =
  | "missing-public-key-credential"
  | "missing-credentials-api"
  | "insecure-context"
  | "embedded-context";

export type PasskeySupportState =
  | { supported: true; issue: null }
  | { supported: false; issue: PasskeySupportIssue };

export const getPasskeySupportState = (): PasskeySupportState => {
  if (typeof PublicKeyCredential === "undefined") {
    return {
      supported: false,
      issue: "missing-public-key-credential",
    };
  }

  if (
    typeof navigator === "undefined" ||
    !navigator.credentials?.create ||
    !navigator.credentials?.get
  ) {
    return {
      supported: false,
      issue: "missing-credentials-api",
    };
  }

  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return {
      supported: false,
      issue: "insecure-context",
    };
  }

  if (
    typeof window !== "undefined" &&
    window.top &&
    window.self &&
    window.top !== window.self
  ) {
    return {
      supported: false,
      issue: "embedded-context",
    };
  }

  return {
    supported: true,
    issue: null,
  };
};

export const isHostnameCompatibleWithRpId = (
  hostname: string,
  rpId: string,
) => {
  const normalizedHostname = hostname.trim().toLowerCase();
  const normalizedRpId = rpId.trim().toLowerCase();

  if (!normalizedHostname || !normalizedRpId) {
    return false;
  }

  return (
    normalizedHostname === normalizedRpId ||
    normalizedHostname.endsWith(`.${normalizedRpId}`)
  );
};

export const getCurrentBrowserUrl = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.href;
};
