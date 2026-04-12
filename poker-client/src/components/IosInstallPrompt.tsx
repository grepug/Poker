import React, { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useLocalization } from "../contexts/LocalizationContext";
import { isIosDevice, isSafariOnIos } from "@/utils/browser-detection";
import { getPwaDisplayModeState } from "../utils/pwa-display-mode";

const IOS_INSTALL_PROMPT_DISMISSED_KEY = "poker.iosInstallPromptDismissed";

const resolveInitialPromptVisibility = (canShowPrompt: boolean) => {
  if (!canShowPrompt) {
    return false;
  }

  if (
    typeof window !== "undefined" &&
    getPwaDisplayModeState(window).displayMode === "standalone"
  ) {
    return false;
  }

  try {
    const dismissed =
      window.localStorage.getItem(IOS_INSTALL_PROMPT_DISMISSED_KEY) === "1";
    return !dismissed;
  } catch {
    return true;
  }
};

export const IosInstallPrompt: React.FC = () => {
  const location = useLocation();
  const { t } = useLocalization();
  const canShowPrompt = useMemo(() => isIosDevice() && isSafariOnIos(), []);
  const [visible, setVisible] = useState(() =>
    resolveInitialPromptVisibility(canShowPrompt),
  );

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(IOS_INSTALL_PROMPT_DISMISSED_KEY, "1");
    } catch {
      // Ignore storage write errors and still dismiss UI.
    }
    setVisible(false);
  };

  const isLobbyRoute = !location.pathname.startsWith("/room");

  if (!visible || !isLobbyRoute) {
    return null;
  }

  return (
    <section className="ios-install-banner" data-testid="ios-install-banner">
      <span className="ios-install-banner__badge" aria-hidden="true">
        ♠
      </span>
      <div className="ios-install-banner__copy">
        <p className="ios-install-banner__title">{t("pwa.iosInstallTitle")}</p>
        <p className="ios-install-banner__body">{t("pwa.iosInstallBody")}</p>
      </div>
      <button
        type="button"
        className="ios-install-banner__close"
        onClick={handleDismiss}
        aria-label={t("common.close")}
      >
        {t("common.close")}
      </button>
    </section>
  );
};
