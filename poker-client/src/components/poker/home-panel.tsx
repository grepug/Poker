import React from "react";
import type { MessageKey } from "@/i18n/messages";

type HomePanelProps = {
  connected: boolean;
  isRecoveringSession: boolean;
  isJoining: boolean;
  inferredRoomId: string;
  effectiveRoomId: string;
  feedback: string | null;
  lastError: string | null;
  useShortDeckRules: boolean;
  maxPlayers: number;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  onUseShortDeckRulesChange: (enabled: boolean) => void;
  onMaxPlayersChange: (value: number) => void;
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
  feedback,
  lastError,
  useShortDeckRules,
  maxPlayers,
  t,
  onUseShortDeckRulesChange,
  onMaxPlayersChange,
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
          <div className="space-y-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-4 py-3">
            <label
              className="flex cursor-pointer items-center gap-3 text-sm text-emerald-100 transition hover:border-emerald-500/80"
              data-testid="short-deck-toggle"
            >
              <input
                type="checkbox"
                checked={useShortDeckRules}
                onChange={(event) => onUseShortDeckRulesChange(event.target.checked)}
                className="h-4 w-4 rounded border-emerald-500/70 bg-emerald-950/60 text-emerald-400 focus:ring-emerald-500/50"
              />
              <span className="font-semibold">{t("home.shortDeckRules")}</span>
            </label>

            <div>
              <label
                htmlFor="max-players-select"
                className="mb-2 block text-sm font-semibold text-emerald-100"
              >
                {t("home.maxPlayers")}
              </label>
              <p className="mb-2 text-xs text-emerald-100/70">
                {t("home.maxPlayersHelp")}
              </p>
              <select
                id="max-players-select"
                value={maxPlayers}
                onChange={(event) => onMaxPlayersChange(Number(event.target.value))}
                data-testid="max-players-select"
                className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
              >
                {Array.from({ length: 14 }, (_, index) => index + 2).map((value) => (
                  <option key={value} value={value}>
                    {t("home.maxPlayersOption", { count: value })}
                  </option>
                ))}
              </select>
            </div>
          </div>

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
