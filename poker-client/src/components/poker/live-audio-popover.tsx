import React from "react";
import type { RefObject } from "react";
import { LiveAudioPanel } from "./live-audio-panel";
import { useAnchoredPopover } from "./use-anchored-popover";

type LiveAudioPopoverProps = {
  anchorRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
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
  reconnectPromptTitle: string;
  reconnectPromptSubtitle: string;
  reconnectLabel: string;
  reconnectDismissLabel: string;
  joinPopoverTitle: string;
  controlPopoverTitle: string;
  closeLabel: string;
  error: string | null;
  available: boolean;
  isConfigLoaded: boolean;
  isConnecting: boolean;
  isJoined: boolean;
  isMuted: boolean;
  isAudioPlaybackBlocked: boolean;
  isReconnecting: boolean;
  showReconnectPrompt: boolean;
  onJoin: () => void;
  onReconnect: () => void;
  onDismissReconnect: () => void;
  onLeave: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onEnableAudio: () => void;
  onClose: () => void;
};

export const LiveAudioPopover: React.FC<LiveAudioPopoverProps> = ({
  anchorRef,
  isOpen,
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
  reconnectPromptTitle,
  reconnectPromptSubtitle,
  reconnectLabel,
  reconnectDismissLabel,
  joinPopoverTitle,
  controlPopoverTitle,
  closeLabel,
  error,
  available,
  isConfigLoaded,
  isConnecting,
  isJoined,
  isMuted,
  isAudioPlaybackBlocked,
  isReconnecting,
  showReconnectPrompt,
  onJoin,
  onReconnect,
  onDismissReconnect,
  onLeave,
  onMute,
  onUnmute,
  onEnableAudio,
  onClose,
}) => {
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const popoverStyle = useAnchoredPopover({
    isOpen,
    anchorRef,
    popoverRef,
    preferredPlacement: "bottom",
    align: "end",
    offset: 10,
  });

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (
        popoverRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const popoverTitle = isJoined
    ? controlPopoverTitle
    : showReconnectPrompt
      ? reconnectPromptTitle
      : joinPopoverTitle;
  const popoverSubtitle = showReconnectPrompt ? reconnectPromptSubtitle : subtitle;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={popoverTitle}
      data-testid="live-audio-popover"
      className="action-quick-confirm-popover action-quick-confirm-popover--wide"
      style={popoverStyle}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200/80">
            {popoverTitle}
          </p>
          <p className="mt-1 text-xs text-emerald-100/70">
            {isJoined ? connectedLabel : popoverSubtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          data-testid="close-live-audio-popover-button"
          className="rounded-full border border-emerald-500/50 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-900/45"
        >
          ×
        </button>
      </div>

      {showReconnectPrompt ? (
        <div
          className="overflow-hidden rounded-2xl border border-cyan-400/35 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_rgba(8,47,73,0.8)_44%,_rgba(6,78,59,0.5)_100%)] shadow-[0_16px_34px_rgba(8,47,73,0.28)]"
          data-testid="live-audio-reconnect-prompt"
        >
          <div className="flex flex-col gap-3 px-3.5 py-3">
            <p className="text-sm text-cyan-100/85">{reconnectPromptSubtitle}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onDismissReconnect}
                className="rounded-full border border-cyan-200/25 bg-black/15 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-cyan-50 transition hover:bg-black/25"
                data-testid="live-audio-reconnect-dismiss-button"
              >
                {reconnectDismissLabel}
              </button>
              <button
                type="button"
                onClick={onReconnect}
                className="rounded-full border border-cyan-200/70 bg-cyan-200 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-slate-950 transition hover:bg-white"
                data-testid="live-audio-reconnect-button"
              >
                {reconnectLabel}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <LiveAudioPanel
          title={title}
          subtitle={subtitle}
          joinLabel={joinLabel}
          leaveLabel={leaveLabel}
          muteLabel={muteLabel}
          unmuteLabel={unmuteLabel}
          enableAudioLabel={enableAudioLabel}
          connectingLabel={connectingLabel}
          connectedLabel={connectedLabel}
          reconnectingLabel={reconnectingLabel}
          mutedLabel={mutedLabel}
          unavailableLabel={unavailableLabel}
          error={error}
          available={available}
          isConfigLoaded={isConfigLoaded}
          isConnecting={isConnecting}
          isJoined={isJoined}
          isMuted={isMuted}
          isAudioPlaybackBlocked={isAudioPlaybackBlocked}
          isReconnecting={isReconnecting}
          onJoin={onJoin}
          onLeave={onLeave}
          onMute={onMute}
          onUnmute={onUnmute}
          onEnableAudio={onEnableAudio}
        />
      )}
    </div>
  );
};
