import React from "react";
import { cn } from "@/lib/utils";
import type { LiveAudioParticipant } from "@/services/live-audio.service";

type LiveAudioPanelProps = {
  title: string;
  subtitle: string;
  joinLabel: string;
  leaveLabel: string;
  muteLabel: string;
  unmuteLabel: string;
  enableAudioLabel: string;
  connectingLabel: string;
  connectedLabel: string;
  reconnectingLabel: string;
  mutedLabel: string;
  unavailableLabel: string;
  rosterLabel: string;
  localParticipantLabel: string;
  error: string | null;
  available: boolean;
  isConfigLoaded: boolean;
  isConnecting: boolean;
  isJoined: boolean;
  isMuted: boolean;
  isAudioPlaybackBlocked: boolean;
  isReconnecting: boolean;
  participants: LiveAudioParticipant[];
  onJoin: () => void;
  onLeave: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onEnableAudio: () => void;
};

export const LiveAudioPanel: React.FC<LiveAudioPanelProps> = ({
  title,
  subtitle,
  joinLabel,
  leaveLabel,
  muteLabel,
  unmuteLabel,
  enableAudioLabel,
  connectingLabel,
  connectedLabel,
  reconnectingLabel,
  mutedLabel,
  unavailableLabel,
  rosterLabel,
  localParticipantLabel,
  error,
  available,
  isConfigLoaded,
  isConnecting,
  isJoined,
  isMuted,
  isAudioPlaybackBlocked,
  isReconnecting,
  participants,
  onJoin,
  onLeave,
  onMute,
  onUnmute,
  onEnableAudio,
}) => {
  const roster = participants.length > 0 ? participants : [];
  const statusLabel = !isConfigLoaded
    ? unavailableLabel
    : isConnecting
      ? connectingLabel
      : isReconnecting
        ? reconnectingLabel
        : isJoined
          ? isMuted
            ? mutedLabel
            : connectedLabel
          : available
            ? subtitle
            : unavailableLabel;

  return (
    <section
      className="mx-3 mt-2 overflow-hidden rounded-2xl border border-cyan-400/40 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_rgba(8,47,73,0.82)_42%,_rgba(6,78,59,0.58)_100%)] shadow-[0_24px_60px_rgba(8,47,73,0.34)]"
      data-testid="live-audio-panel"
    >
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.9)]" />
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-50">
                {title}
              </h3>
            </div>
            <p className="mt-1 text-sm text-cyan-100/85">{statusLabel}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isJoined ? (
              <button
                type="button"
                onClick={onJoin}
                disabled={!available || isConnecting}
                className="rounded-full border border-cyan-200/70 bg-cyan-200 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
                data-testid="live-audio-join-button"
              >
                {isConnecting ? connectingLabel : joinLabel}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={isMuted ? onUnmute : onMute}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wide transition",
                    isMuted
                      ? "border border-emerald-200/70 bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
                      : "border border-amber-200/70 bg-amber-300 text-amber-950 hover:bg-amber-200",
                  )}
                  data-testid="live-audio-mute-button"
                >
                  {isMuted ? unmuteLabel : muteLabel}
                </button>
                <button
                  type="button"
                  onClick={onLeave}
                  className="rounded-full border border-rose-300/65 bg-rose-950/35 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-rose-100 transition hover:bg-rose-900/55"
                  data-testid="live-audio-leave-button"
                >
                  {leaveLabel}
                </button>
                {isAudioPlaybackBlocked && (
                  <button
                    type="button"
                    onClick={onEnableAudio}
                    className="rounded-full border border-cyan-200/70 bg-cyan-200 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-slate-950 transition hover:bg-white"
                  >
                    {enableAudioLabel}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            {rosterLabel}
          </p>
          <p className="text-xs font-semibold text-cyan-50/80">
            {roster.length}
          </p>
        </div>

        <div
          className="flex flex-wrap gap-2"
          data-testid="live-audio-participant-roster"
        >
          {roster.length === 0 ? (
            <span className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs text-cyan-50/65">
              {subtitle}
            </span>
          ) : (
            roster.map((participant) => (
              <div
                key={participant.identity}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_10px_30px_rgba(15,23,42,0.22)]",
                  participant.isSpeaking
                    ? "border-emerald-300/80 bg-emerald-300/18 text-emerald-50"
                    : "border-white/10 bg-black/15 text-cyan-50/85",
                )}
                data-testid="live-audio-participant-pill"
              >
                <span aria-hidden="true">{participant.avatarEmoji ?? "🎙"}</span>
                <span className="max-w-[10rem] truncate">
                  {participant.displayName}
                  {participant.isLocal ? ` ${localParticipantLabel}` : ""}
                </span>
                {participant.isMuted && (
                  <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cyan-50/70">
                    {mutedLabel}
                  </span>
                )}
                {participant.isSpeaking && (
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />
                )}
              </div>
            ))
          )}
        </div>

        {error && (
          <p
            className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            data-testid="live-audio-error"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
};
