import React from "react";
import type { LiveAudioParticipant } from "@/services/live-audio.service";
import { LiveAudioPanel } from "./live-audio-panel";

type LiveAudioModalProps = {
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
  closeLabel: string;
  modalTitle: string;
  modalSubtitle: string;
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
  onClose: () => void;
};

export const LiveAudioModal: React.FC<LiveAudioModalProps> = ({
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
  closeLabel,
  modalTitle,
  modalSubtitle,
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
  onClose,
}) => (
  <div
    className="fixed inset-0 z-[79] overflow-y-auto bg-emerald-950/88 p-4 backdrop-blur-sm"
    data-testid="live-audio-modal"
  >
    <section className="surface-panel mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">{modalTitle}</h3>
          <p className="mt-1 text-sm text-emerald-100/80">{modalSubtitle}</p>
        </div>
        <button
          onClick={onClose}
          data-testid="close-live-audio-modal-button"
          className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
        >
          {closeLabel}
        </button>
      </div>

      <div className="mt-6 flex-1">
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
          rosterLabel={rosterLabel}
          localParticipantLabel={localParticipantLabel}
          error={error}
          available={available}
          isConfigLoaded={isConfigLoaded}
          isConnecting={isConnecting}
          isJoined={isJoined}
          isMuted={isMuted}
          isAudioPlaybackBlocked={isAudioPlaybackBlocked}
          isReconnecting={isReconnecting}
          participants={participants}
          onJoin={onJoin}
          onLeave={onLeave}
          onMute={onMute}
          onUnmute={onUnmute}
          onEnableAudio={onEnableAudio}
        />
      </div>
    </section>
  </div>
);
