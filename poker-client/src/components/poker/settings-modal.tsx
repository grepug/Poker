import React from "react";
import type { Locale, MessageKey } from "@/i18n/messages";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type SettingsModalProps = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  profileDisplayName: string;
  profileAvatarEmoji: string;
  profileEmojiOptions: readonly string[];
  onProfileDisplayNameChange: (value: string) => void;
  onProfileAvatarEmojiChange: (emoji: string) => void;
  onSaveProfile: () => void;
  isSavingProfile: boolean;
  profileFeedback?: string | null;
  isHost: boolean;
  isPlayerStreetRevealEnabled: boolean;
  onStreetRevealChange: (value: boolean) => void;
  onClose: () => void;
  t: Translate;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  locale,
  onLocaleChange,
  profileDisplayName,
  profileAvatarEmoji,
  profileEmojiOptions,
  onProfileDisplayNameChange,
  onProfileAvatarEmojiChange,
  onSaveProfile,
  isSavingProfile,
  profileFeedback,
  isHost,
  isPlayerStreetRevealEnabled,
  onStreetRevealChange,
  onClose,
  t,
}) => {
  return (
    <div
      className="fixed inset-0 z-[76] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
      data-testid="settings-modal"
    >
      <div className="surface-panel w-full max-w-xl p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-black text-white">{t("game.settings.title")}</h3>
          <button
            onClick={onClose}
            data-testid="close-settings-button"
            className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
          >
            {t("common.close")}
          </button>
        </div>
        <p className="mt-1 text-sm text-emerald-100/80">{t("game.settings.summary")}</p>

        <div className="mt-4 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
          <label
            htmlFor="language-select"
            className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70"
          >
            {t("common.language")}
          </label>
          <p className="mt-1 text-xs text-emerald-100/70">{t("game.settings.languageHelp")}</p>
          <select
            id="language-select"
            value={locale}
            onChange={(event) =>
              onLocaleChange(event.target.value === "zh_hans" ? "zh_hans" : "en")
            }
            data-testid="language-select"
            className="mt-3 w-full rounded-xl border border-emerald-700/60 bg-emerald-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
          >
            <option value="en">{t("game.settings.english")}</option>
            <option value="zh_hans">{t("game.settings.chineseSimplified")}</option>
          </select>
        </div>

        <div className="mt-4 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
            {t("game.settings.profileTitle")}
          </p>
          <p className="mt-1 text-xs text-emerald-100/70">
            {t("game.settings.profileHelp")}
          </p>
          <label
            htmlFor="settings-profile-display-name"
            className="mt-3 block text-xs font-semibold uppercase tracking-wide text-emerald-100/70"
          >
            {t("game.settings.profileDisplayName")}
          </label>
          <input
            id="settings-profile-display-name"
            value={profileDisplayName}
            onChange={(event) => onProfileDisplayNameChange(event.target.value)}
            aria-label={t("game.settings.profileDisplayName")}
            className="mt-2 w-full rounded-xl border border-emerald-700/60 bg-emerald-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
            placeholder={t("game.settings.profileDisplayNamePlaceholder")}
          />
          <div className="mt-3 grid max-h-36 grid-cols-10 gap-1 overflow-y-auto rounded-lg border border-emerald-700/60 bg-emerald-950/50 p-2">
            {profileEmojiOptions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onProfileAvatarEmojiChange(emoji)}
                aria-label={t("game.settings.profileSelectAvatar", { emoji })}
                aria-pressed={profileAvatarEmoji === emoji}
                className={`h-8 rounded-md text-lg transition ${
                  profileAvatarEmoji === emoji
                    ? "bg-emerald-400/25 ring-1 ring-emerald-300/80"
                    : "hover:bg-emerald-500/15"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          {profileFeedback && (
            <div className="mt-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {profileFeedback}
            </div>
          )}
          <button
            type="button"
            onClick={onSaveProfile}
            disabled={isSavingProfile}
            className="mt-3 w-full rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("game.settings.profileSave")}
          </button>
        </div>

        {isHost && (
          <div
            className="mt-4 rounded-xl border border-cyan-700/60 bg-cyan-950/35 p-4"
            data-testid="host-settings-section"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
              {t("game.settings.hostOnly")}
            </p>
            <p className="mt-1 text-xs text-cyan-100/70">
              {t("game.settings.hostStreetRevealHelp")}
            </p>
            <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-cyan-50">
              <input
                type="checkbox"
                checked={isPlayerStreetRevealEnabled}
                onChange={(event) => onStreetRevealChange(event.target.checked)}
                data-testid="allow-player-street-reveal-toggle"
                className="h-4 w-4 accent-cyan-400"
              />
              <span>{t("game.settings.allowPlayerStreetReveal")}</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
