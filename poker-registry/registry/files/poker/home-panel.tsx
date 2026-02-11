import React, { type RefObject } from "react";
import type { MessageKey } from "@/i18n/messages";

type HomePanelProps = {
  connected: boolean;
  isRecoveringSession: boolean;
  isJoining: boolean;
  inferredRoomId: string;
  effectiveRoomId: string;
  playerName: string;
  playerEmoji: string;
  isEmojiPopoverOpen: boolean;
  feedback: string | null;
  lastError: string | null;
  emojiOptions: readonly string[];
  emojiPickerRef?: RefObject<HTMLDivElement | null>;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  onPlayerNameChange: (value: string) => void;
  onToggleEmojiPopover: () => void;
  onRandomEmoji: () => void;
  onEmojiPick: (emoji: string) => void;
  onCreateRoom: () => void;
  onEnableJoinMode: () => void;
  onRoomIdChange: (value: string) => void;
  onJoinRoom: () => void;
  onBack: () => void;
};

export const HomePanel: React.FC<HomePanelProps> = ({
  connected,
  isRecoveringSession,
  isJoining,
  inferredRoomId,
  effectiveRoomId,
  playerName,
  playerEmoji,
  isEmojiPopoverOpen,
  feedback,
  lastError,
  emojiOptions,
  emojiPickerRef,
  t,
  onPlayerNameChange,
  onToggleEmojiPopover,
  onRandomEmoji,
  onEmojiPick,
  onCreateRoom,
  onEnableJoinMode,
  onRoomIdChange,
  onJoinRoom,
  onBack,
}) => (
  <section className="surface-panel w-full max-w-md p-6 md:p-8" data-testid="home-panel">
    <div className="mb-8 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">
        {t("home.personalTable")}
      </p>
      <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
        {t("home.pokerGame")}
      </h1>
      <p className="mt-2 text-sm text-emerald-100/70">{t("home.texasHoldemOnline")}</p>
      <div className="mt-5">
        {connected ? (
          <span className="hud-chip text-emerald-200" data-testid="connection-status">
            ● {t("home.connected")}
          </span>
        ) : (
          <span
            className="hud-chip border-red-500/40 bg-red-950/60 text-red-200"
            data-testid="connection-status"
          >
            ● {t("home.disconnected")}
          </span>
        )}
      </div>
    </div>

    <div className="space-y-5">
      {isRecoveringSession && (
        <div
          className="rounded-xl border border-sky-400/50 bg-sky-500/10 px-3 py-2 text-sm text-sky-200"
          data-testid="session-recovery-status"
        >
          {t("home.reconnecting")}
        </div>
      )}

      <div>
        <label htmlFor="player-name" className="mb-2 block text-sm font-semibold text-emerald-100">
          {t("home.yourName")}
        </label>
        <input
          id="player-name"
          type="text"
          value={playerName}
          onChange={(event) => onPlayerNameChange(event.target.value)}
          placeholder={t("home.enterName")}
          data-testid="name-input"
          className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>

      <div className="relative" ref={emojiPickerRef}>
        <label htmlFor="player-emoji" className="mb-2 block text-sm font-semibold text-emerald-100">
          {t("home.avatarEmoji")}
        </label>
        <div className="flex items-center gap-2">
          <button
            id="player-emoji"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isEmojiPopoverOpen}
            onClick={onToggleEmojiPopover}
            data-testid="emoji-select"
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-left text-white outline-none transition hover:border-emerald-500/80 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="text-2xl leading-none" aria-hidden="true">
                {playerEmoji}
              </span>
              <span className="truncate text-sm text-emerald-100/90">{t("home.avatarEmoji")}</span>
            </span>
            <span className="ml-3 text-sm text-emerald-300/80" aria-hidden="true">
              {isEmojiPopoverOpen ? "▴" : "▾"}
            </span>
          </button>
          <button
            type="button"
            onClick={onRandomEmoji}
            data-testid="emoji-randomize-button"
            className="rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-3 py-3 text-xl leading-none text-emerald-100 transition hover:border-emerald-500/80 hover:bg-emerald-900/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            aria-label={t("home.randomEmoji")}
            title={t("home.randomEmoji")}
          >
            🎲
          </button>
        </div>
        {isEmojiPopoverOpen && (
          <div
            role="dialog"
            aria-label={t("home.avatarEmoji")}
            data-testid="emoji-popover"
            className="absolute z-30 mt-2 w-full rounded-xl border border-emerald-600/80 bg-emerald-950/95 p-3 shadow-2xl shadow-emerald-900/40 backdrop-blur-sm"
          >
            <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto pr-1 sm:grid-cols-10">
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onEmojiPick(emoji)}
                  data-testid="emoji-option"
                  data-emoji={emoji}
                  aria-label={`${t("home.avatarEmoji")} ${emoji}`}
                  className={`flex h-9 items-center justify-center rounded-lg text-xl leading-none transition ${
                    playerEmoji === emoji
                      ? "bg-emerald-400/25 ring-1 ring-emerald-300/80"
                      : "hover:bg-emerald-500/15"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {(feedback || lastError) && (
        <div
          className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
          data-testid="form-feedback"
        >
          {feedback || lastError}
        </div>
      )}

      {!isJoining ? (
        <>
          <button
            onClick={onCreateRoom}
            disabled={!connected || isRecoveringSession}
            data-testid="create-room-button"
            className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("home.createRoom")}
          </button>

          <button
            onClick={onEnableJoinMode}
            disabled={isRecoveringSession}
            data-testid="join-toggle-button"
            className="w-full rounded-xl border border-emerald-500/70 bg-transparent px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
          >
            {t("home.joinExistingRoom")}
          </button>
        </>
      ) : (
        <>
          <div>
            <label htmlFor="room-code" className="mb-2 block text-sm font-semibold text-emerald-100">
              {t("home.roomCode")}
            </label>
            <input
              id="room-code"
              type="text"
              value={effectiveRoomId}
              onChange={(event) => onRoomIdChange(event.target.value.toUpperCase())}
              placeholder={t("home.enterRoomCode")}
              data-testid="room-id-input"
              disabled={Boolean(inferredRoomId)}
              className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <button
            onClick={onJoinRoom}
            disabled={!connected || isRecoveringSession}
            data-testid="join-room-button"
            className="w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("home.joinRoom")}
          </button>

          <button
            onClick={onBack}
            data-testid="back-button"
            className="w-full rounded-xl border border-slate-500/70 bg-slate-700/20 px-4 py-3 font-semibold text-slate-200 transition hover:bg-slate-700/40"
          >
            {t("common.back")}
          </button>
        </>
      )}
    </div>

    <div className="mt-8 border-t border-emerald-900/80 pt-4 text-center text-xs text-emerald-200/70">
      {t("home.footer")}
    </div>
  </section>
);
