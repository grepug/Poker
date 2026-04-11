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
  joinPopoverTitle: string;
  controlPopoverTitle: string;
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
  joinPopoverTitle,
  controlPopoverTitle,
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

  const popoverTitle = isJoined ? controlPopoverTitle : joinPopoverTitle;

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
            {isJoined ? connectedLabel : subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="close-live-audio-popover-button"
          className="rounded-full border border-emerald-500/50 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-900/45"
        >
          ×
        </button>
      </div>

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
    </div>
  );
};
