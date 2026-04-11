import React from "react";
import { cn } from "@/lib/utils";

type HiddenHudCopy = {
  potLabel: string;
  chipsLabel: string;
  roundLabel?: string | null;
  turnLabel?: string | null;
};

type ChatPreview = {
  title: string;
  senderName: string;
  senderEmoji?: string | null;
  message: string;
  timeIso: string;
  timeLabel: string;
  dismissLabel: string;
};

type TableTopBarProps = {
  roomTitle: string;
  playerCountLabel: string;
  ruleVariantLabel: string;
  inviteCopyLabel: string;
  inviteCopyStatus: string | null;
  inviteCopyStatusTone: "success" | "error" | null;
  leaveLabel: string;
  settingsLabel: string;
  rulesLabel: string;
  rankingsLabel: string;
  chatLabel: string;
  liveAudioLabel: string;
  liveAudioJoined: boolean;
  liveAudioButtonRef?: React.Ref<HTMLButtonElement>;
  finalResultsLabel: string;
  startLabel: string;
  startDisabled?: boolean;
  hiddenHudCopy: HiddenHudCopy;
  isChatPanelOpen: boolean;
  showChatButton?: boolean;
  showChatPreview?: boolean;
  chatPreview: ChatPreview | null;
  showFinalResultsButton: boolean;
  showStartGameButton: boolean;
  onCopyInvite: () => void;
  onLeave: () => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
  onOpenRankings: () => void;
  onToggleChat: () => void;
  onOpenLiveAudio: () => void;
  onOpenFinalResults: () => void;
  onStartGame: () => void;
  onOpenChatFromPreview: () => void;
  onDismissPreview: () => void;
};

export const TableTopBar: React.FC<TableTopBarProps> = ({
  roomTitle,
  playerCountLabel,
  ruleVariantLabel,
  inviteCopyLabel,
  inviteCopyStatus,
  inviteCopyStatusTone,
  leaveLabel,
  settingsLabel,
  rulesLabel,
  rankingsLabel,
  chatLabel,
  liveAudioLabel,
  liveAudioJoined,
  liveAudioButtonRef,
  finalResultsLabel,
  startLabel,
  startDisabled = false,
  hiddenHudCopy,
  isChatPanelOpen,
  showChatButton = true,
  showChatPreview = true,
  chatPreview,
  showFinalResultsButton,
  showStartGameButton,
  onCopyInvite,
  onLeave,
  onOpenSettings,
  onOpenRules,
  onOpenRankings,
  onToggleChat,
  onOpenLiveAudio,
  onOpenFinalResults,
  onStartGame,
  onOpenChatFromPreview,
  onDismissPreview,
}) => {
  return (
    <header className="table-micro-hud">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1
              className="max-w-[55vw] truncate text-base font-black tracking-tight text-white sm:max-w-[24rem]"
              data-testid="room-title"
            >
              {roomTitle}
            </h1>
            <button
              onClick={onCopyInvite}
              data-testid="copy-room-url-button"
              className="shrink-0 rounded-full border border-cyan-300/55 bg-cyan-900/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/40"
            >
              {inviteCopyLabel}
            </button>
            <span
              className="shrink-0 rounded-full border border-violet-300/55 bg-violet-900/35 px-2.5 py-0.5 text-[11px] font-semibold text-violet-100"
              data-testid="room-rule-variant"
            >
              {ruleVariantLabel}
            </span>
          </div>
          {inviteCopyStatus && (
            <span
              data-testid="copy-room-url-status"
              className={cn(
                "mt-1 inline-block text-xs font-semibold",
                inviteCopyStatusTone === "error" ? "text-amber-200" : "text-emerald-200",
              )}
            >
              {inviteCopyStatus}
            </span>
          )}
        </div>
        <button
          onClick={onLeave}
          data-testid="leave-room-button"
          className="ml-auto shrink-0 rounded-full border border-rose-400/70 bg-rose-900/30 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-rose-100 transition hover:bg-rose-800/40"
        >
          {leaveLabel}
        </button>
      </div>

      <div className="pointer-events-none absolute -left-[9999px] top-0" aria-live="polite">
        <span className="hud-chip" data-testid="pot-value">
          {hiddenHudCopy.potLabel}
        </span>
        <span className="hud-chip" data-testid="your-chips">
          {hiddenHudCopy.chipsLabel}
        </span>
        <span className="hud-chip" data-testid="room-player-count">
          {playerCountLabel}
        </span>
        {hiddenHudCopy.roundLabel && (
          <span className="hud-chip" data-testid="round-value">
            {hiddenHudCopy.roundLabel}
          </span>
        )}
        {hiddenHudCopy.turnLabel && (
          <span
            className="hud-chip border-amber-400/70 bg-amber-500/20 text-amber-100"
            data-testid="turn-player"
          >
            {hiddenHudCopy.turnLabel}
          </span>
        )}
      </div>

      <section className="table-controls-strip">
        <button
          onClick={onOpenSettings}
          data-testid="open-settings-button"
          className="rounded-full border border-cyan-400/65 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-900/45"
        >
          {settingsLabel}
        </button>
        <button
          onClick={onOpenRules}
          data-testid="open-rules-button"
          className="rounded-full border border-indigo-300/65 bg-indigo-900/35 px-3 py-1 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-800/45"
        >
          {rulesLabel}
        </button>
        <button
          onClick={onOpenRankings}
          data-testid="open-rankings-button"
          className="rounded-full border border-emerald-400/65 bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
        >
          {rankingsLabel}
        </button>
        {showChatButton && (
          <button
            onClick={onToggleChat}
            data-testid="open-chat-button"
            className="rounded-full border border-cyan-300/65 bg-cyan-900/35 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/45"
          >
            {chatLabel}
          </button>
        )}
        <button
          ref={liveAudioButtonRef}
          onClick={onOpenLiveAudio}
          data-testid="open-live-audio-button"
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/65 bg-cyan-900/35 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/45"
        >
          <span>{liveAudioLabel}</span>
          {liveAudioJoined && (
            <span
              className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]"
              data-testid="live-audio-joined-indicator"
            />
          )}
        </button>
        {showFinalResultsButton && (
          <button
            onClick={onOpenFinalResults}
            data-testid="open-final-results-button"
            className="rounded-full border border-amber-300/70 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30"
          >
            {finalResultsLabel}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {showStartGameButton && (
            <button
              onClick={onStartGame}
              disabled={startDisabled}
              data-testid="start-game-button"
              className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {startLabel}
            </button>
          )}
        </div>
      </section>

      {showChatPreview && !isChatPanelOpen && chatPreview && (
        <div className="chat-preview-strip" data-testid="chat-preview-strip">
          <button
            type="button"
            className="chat-preview-strip__open"
            onClick={onOpenChatFromPreview}
            data-testid="chat-preview-open"
          >
            <span className="chat-preview-strip__title">{chatPreview.title}</span>
            <span className="chat-preview-strip__content">
              <span className="chat-preview-strip__sender">
                {chatPreview.senderEmoji ? `${chatPreview.senderEmoji} ` : ""}
                {chatPreview.senderName}
              </span>
              <span className="chat-preview-strip__message">{chatPreview.message}</span>
              <time className="chat-preview-strip__time" dateTime={chatPreview.timeIso}>
                {chatPreview.timeLabel}
              </time>
            </span>
          </button>
          <button
            type="button"
            className="chat-preview-strip__dismiss"
            data-testid="chat-preview-dismiss"
            aria-label={chatPreview.dismissLabel}
            title={chatPreview.dismissLabel}
            onClick={onDismissPreview}
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
};
