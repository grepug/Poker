import React, { useState } from "react";
import { useLocalization } from "@/contexts/LocalizationContext";
import { isIosDevice } from "@/utils/browser-detection";
import { writeTextToClipboard } from "@/utils/clipboard";

type CopyStatus = "idle" | "success" | "error";

type WeChatBrowserGateProps = {
  currentUrl: string;
};

export const WeChatBrowserGate: React.FC<WeChatBrowserGateProps> = ({
  currentUrl,
}) => {
  const { t } = useLocalization();
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const isIos = isIosDevice();

  const handleCopyLink = async () => {
    if (!currentUrl) {
      setCopyStatus("error");
      return;
    }

    const copied = await writeTextToClipboard(currentUrl);
    setCopyStatus(copied ? "success" : "error");
  };

  const copyFeedback =
    copyStatus === "success"
      ? t("wechatGate.copySuccess")
      : copyStatus === "error"
        ? t("wechatGate.copyFailure")
        : null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-emerald-950/92 p-4 backdrop-blur-sm"
      data-testid="wechat-browser-gate"
    >
      <div
        className="surface-panel w-full max-w-xl p-5 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wechat-browser-gate-title"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300/80">
          {t("wechatGate.eyebrow")}
        </p>
        <h2
          id="wechat-browser-gate-title"
          className="mt-2 text-2xl font-black tracking-tight text-white"
        >
          {t("wechatGate.title")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-emerald-100/85">
          {t("wechatGate.body", {
            browserName: isIos ? "Safari" : t("wechatGate.systemBrowserGeneric"),
          })}
        </p>

        <div className="mt-5 space-y-3">
          <section className="rounded-2xl border border-emerald-400/20 bg-emerald-950/40 p-4">
            <p className="text-sm font-semibold text-white">
              {t("wechatGate.option1Title")}
            </p>
            <p className="mt-2 text-sm leading-6 text-emerald-100/80">
              {t("wechatGate.option1Body")}
            </p>
            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-black/15 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/70">
                {t("wechatGate.currentLinkLabel")}
              </p>
              <p
                className="mt-1 break-all text-sm text-emerald-50"
                data-testid="wechat-browser-current-url"
              >
                {currentUrl}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleCopyLink();
              }}
              disabled={!currentUrl}
              data-testid="wechat-browser-copy-link"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-900/50 disabled:text-emerald-100/60"
            >
              {t("wechatGate.copyButton")}
            </button>
            {copyFeedback && (
              <p
                className={`mt-3 text-sm ${
                  copyStatus === "success" ? "text-emerald-200" : "text-amber-200"
                }`}
                data-testid="wechat-browser-copy-feedback"
              >
                {copyFeedback}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-white">
              {t("wechatGate.option2Title")}
            </p>
            <p className="mt-2 text-sm leading-6 text-emerald-100/80">
              {t("wechatGate.option2Body")}
            </p>
            <p className="mt-3 rounded-xl border border-amber-400/30 bg-black/10 px-3 py-2 text-sm font-semibold text-amber-100">
              {t("wechatGate.option2Action")}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
