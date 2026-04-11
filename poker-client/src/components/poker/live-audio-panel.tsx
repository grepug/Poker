import React from "react";
import { cn } from "@/lib/utils";

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
  error: string | null;
  available: boolean;
  isConfigLoaded: boolean;
  isConnecting: boolean;
  isJoined: boolean;
  isMuted: boolean;
  isAudioPlaybackBlocked: boolean;
  isReconnecting: boolean;
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
  error,
  available,
  isConfigLoaded,
  isConnecting,
  isJoined,
  isMuted,
  isAudioPlaybackBlocked,
  isReconnecting,
  onJoin,
  onLeave,
  onMute,
  onUnmute,
  onEnableAudio,
}) => {
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
      className="overflow-hidden rounded-2xl border border-cyan-400/35 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_rgba(8,47,73,0.8)_44%,_rgba(6,78,59,0.5)_100%)] shadow-[0_16px_34px_rgba(8,47,73,0.28)]"
      data-testid="live-audio-panel"
    >
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.9)]" />
              <h3 className="text-xs font-black uppercase tracking-[0.18em] text-cyan-50">
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
              </>
            )}
          </div>
        </div>

        {isAudioPlaybackBlocked && (
          <button
            type="button"
            onClick={onEnableAudio}
            className={cn(
              "w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition",
              isJoined
                ? "border-cyan-200/35 bg-cyan-200/10 text-cyan-50 hover:bg-cyan-200/15"
                : "border-cyan-200/18 bg-black/10 text-cyan-100/75 hover:bg-black/20",
            )}
            data-testid="live-audio-enable-audio-button"
          >
            {enableAudioLabel}
          </button>
        )}

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
