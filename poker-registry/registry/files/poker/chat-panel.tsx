import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "poker-types";
import { useLocalization } from "@/contexts/LocalizationContext";
import { useGame } from "@/contexts/GameContext";
import { resolveServerResourceUrl } from "@/services/socket.service";
import {
  getVoicePlaybackState,
  subscribeVoicePlayback,
  toggleVoicePlayback,
} from "@/services/voice-playback.service";
import { formatRelativeTime } from "@/utils/relative-time";
import {
  computeVoiceBubbleWidthPx,
  formatVoiceDurationPrime,
  resolveVoiceAudioUrl,
} from "@/utils/voice-message";

const VOICE_MAX_BYTES = 2 * 1024 * 1024;
const VOICE_MAX_DURATION_MS = 60 * 1000;
const VOICE_RELEASE_TAIL_MS = 300;

type ChatPanelProps = {
  onClose: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
};

const chooseRecorderMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
};

type VoicePlaybackBarProps = {
  sourceUrl: string;
  durationMs: number;
  playLabel: string;
  stopLabel: string;
  testId: string;
};

const VoicePlaybackBar: React.FC<VoicePlaybackBarProps> = ({
  sourceUrl,
  durationMs,
  playLabel,
  stopLabel,
  testId,
}) => {
  const [playbackState, setPlaybackState] = useState(getVoicePlaybackState);
  const bubbleWidthPx = computeVoiceBubbleWidthPx(durationMs);

  useEffect(() => subscribeVoicePlayback(setPlaybackState), []);

  const isPlaying = playbackState.isPlaying && playbackState.sourceUrl === sourceUrl;

  return (
    <button
      type="button"
      data-testid={testId}
      className={`chat-panel__voice-player ${isPlaying ? "chat-panel__voice-player--playing" : ""}`}
      style={{ width: `${bubbleWidthPx}px`, minWidth: "50px", maxWidth: "72%", flex: "0 0 auto" }}
      onClick={() => {
        void toggleVoicePlayback(sourceUrl);
      }}
      aria-label={isPlaying ? stopLabel : playLabel}
      title={isPlaying ? stopLabel : playLabel}
    >
      <span className="chat-panel__voice-icon" aria-hidden="true">
        {isPlaying ? "■" : "▶"}
      </span>
      <span className="chat-panel__voice-duration">{formatVoiceDurationPrime(durationMs)}</span>
    </button>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
  const { locale, t } = useLocalization();
  const {
    room,
    player,
    chatMessages,
    chatHasMore,
    chatLoadingHistory,
    loadOlderChatMessages,
    sendChatText,
    sendChatVoice,
    setChatPanelOpen,
  } = useGame();

  const [draft, setDraft] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [recordingMode, setRecordingMode] = useState<"touch" | "keyboard" | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const recordingMaxTimerRef = useRef<number | null>(null);
  const stopTailTimerRef = useRef<number | null>(null);
  const shouldCancelRef = useRef(false);
  const isMountedRef = useRef(true);
  const isAtBottomRef = useRef(true);
  const historyAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const lastRenderedMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeNow(Date.now());
    }, 30 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setChatPanelOpen(true);
    return () => {
      setChatPanelOpen(false);
    };
  }, [setChatPanelOpen]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearRecordingTimers = useCallback(() => {
    if (recordingIntervalRef.current !== null) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (recordingMaxTimerRef.current !== null) {
      window.clearTimeout(recordingMaxTimerRef.current);
      recordingMaxTimerRef.current = null;
    }
    if (stopTailTimerRef.current !== null) {
      window.clearTimeout(stopTailTimerRef.current);
      stopTailTimerRef.current = null;
    }
  }, []);

  const stopMediaStream = useCallback(() => {
    if (!mediaStreamRef.current) {
      return;
    }

    for (const track of mediaStreamRef.current.getTracks()) {
      track.stop();
    }
    mediaStreamRef.current = null;
  }, []);

  const uploadVoiceBlob = useCallback(
    async (blob: Blob, durationMs: number, mimeType: string) => {
      if (!room?.id || !player?.id) {
        return;
      }

      if (blob.size > VOICE_MAX_BYTES) {
        setChatError(t("game.chat.error.voiceTooLarge", { maxMb: 2 }));
        return;
      }

      if (durationMs > VOICE_MAX_DURATION_MS) {
        setChatError(t("game.chat.error.voiceTooLong", { maxSeconds: 60 }));
        return;
      }

      setIsUploadingVoice(true);
      setChatError(null);

      try {
        const formData = new FormData();
        const extension = mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("mp4")
            ? "m4a"
            : "webm";
        formData.append("audio", blob, `voice-${Date.now()}.${extension}`);
        formData.append("roomId", room.id);
        formData.append("playerId", player.id);
        formData.append("durationMs", String(durationMs));

        const response = await fetch(resolveServerResourceUrl("/api/chat/voice-upload"), {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const payload = (await response.json()) as {
          success?: boolean;
          voice?: {
            audioUrl: string;
            durationMs: number;
            sizeBytes: number;
            mimeType: string;
          };
        };

        if (!response.ok || !payload?.success || !payload.voice) {
          throw new Error("upload failed");
        }

        sendChatVoice(payload.voice);
      } catch {
        setChatError(t("game.chat.error.uploadFailed"));
      } finally {
        if (isMountedRef.current) {
          setIsUploadingVoice(false);
        }
      }
    },
    [player?.id, room?.id, sendChatVoice, t],
  );

  const stopRecordingNow = useCallback(
    (cancel: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        clearRecordingTimers();
        stopMediaStream();
        setIsRecording(false);
        setRecordingMode(null);
        setRecordingSeconds(0);
        return;
      }

      shouldCancelRef.current = cancel;
      clearRecordingTimers();
      setIsRecording(false);
      setRecordingMode(null);

      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        stopMediaStream();
      }
    },
    [clearRecordingTimers, stopMediaStream],
  );

  const scheduleStopRecording = useCallback(
    (cancel: boolean) => {
      if (!mediaRecorderRef.current) {
        return;
      }

      if (stopTailTimerRef.current !== null) {
        window.clearTimeout(stopTailTimerRef.current);
      }

      stopTailTimerRef.current = window.setTimeout(() => {
        stopRecordingNow(cancel);
      }, VOICE_RELEASE_TAIL_MS);
    },
    [stopRecordingNow],
  );

  const startRecording = useCallback(
    async (mode: "touch" | "keyboard") => {
      if (isRecording || isUploadingVoice) {
        return;
      }

      if (
        typeof window === "undefined" ||
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setChatError(t("game.chat.error.recordingUnsupported"));
        return;
      }

      setChatError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = chooseRecorderMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        mediaStreamRef.current = stream;
        mediaRecorderRef.current = recorder;
        recordingChunksRef.current = [];
        shouldCancelRef.current = false;
        recordingStartedAtRef.current = Date.now();

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) {
            recordingChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const durationMs = Math.max(1, Date.now() - recordingStartedAtRef.current);
          const cancel = shouldCancelRef.current;
          const chunks = recordingChunksRef.current;
          recordingChunksRef.current = [];

          stopMediaStream();
          mediaRecorderRef.current = null;
          setRecordingSeconds(0);

          if (cancel || chunks.length === 0) {
            return;
          }

          const blobMimeType = recorder.mimeType || mimeType || "audio/webm";
          const voiceBlob = new Blob(chunks, { type: blobMimeType });
          await uploadVoiceBlob(voiceBlob, durationMs, blobMimeType);
        };

        recorder.start(200);
        setIsRecording(true);
        setRecordingMode(mode);
        setRecordingSeconds(0);

        recordingIntervalRef.current = window.setInterval(() => {
          const elapsed = Date.now() - recordingStartedAtRef.current;
          setRecordingSeconds(Math.floor(elapsed / 1000));
        }, 200);

        recordingMaxTimerRef.current = window.setTimeout(() => {
          stopRecordingNow(false);
        }, VOICE_MAX_DURATION_MS);
      } catch {
        setChatError(t("game.chat.error.microphoneDenied"));
      }
    },
    [isRecording, isUploadingVoice, stopMediaStream, stopRecordingNow, t, uploadVoiceBlob],
  );

  useEffect(
    () => () => {
      clearRecordingTimers();
      stopMediaStream();
    },
    [clearRecordingTimers, stopMediaStream],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      if (isEditableTarget(event.target) || event.repeat) {
        return;
      }

      event.preventDefault();
      if (!isRecording) {
        void startRecording("keyboard");
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      if (recordingMode !== "keyboard") {
        return;
      }

      event.preventDefault();
      scheduleStopRecording(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isRecording, recordingMode, scheduleStopRecording, startRecording]);

  const releaseVoicePointerCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleVoicePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void startRecording("touch");
  };

  const handleVoicePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    releaseVoicePointerCapture(event);
    scheduleStopRecording(false);
  };

  const handleVoicePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    releaseVoicePointerCapture(event);
    scheduleStopRecording(true);
  };

  const handleVoicePointerLeave = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (recordingMode !== "touch") {
      return;
    }

    releaseVoicePointerCapture(event);
    scheduleStopRecording(false);
  };

  const handleSubmitText = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isUploadingVoice) {
      return;
    }

    const nextText = draft.trim();
    if (!nextText) {
      return;
    }

    sendChatText(nextText);
    setDraft("");
  };

  const handleScroll = useCallback(() => {
    const listNode = listRef.current;
    if (!listNode) {
      return;
    }

    const isNearBottom =
      listNode.scrollHeight - listNode.scrollTop - listNode.clientHeight < 96;
    isAtBottomRef.current = isNearBottom;

    if (listNode.scrollTop <= 48 && chatHasMore && !chatLoadingHistory) {
      historyAnchorRef.current = {
        height: listNode.scrollHeight,
        top: listNode.scrollTop,
      };
      loadOlderChatMessages();
    }
  }, [chatHasMore, chatLoadingHistory, loadOlderChatMessages]);

  useEffect(() => {
    const listNode = listRef.current;
    if (!listNode) {
      return;
    }

    if (historyAnchorRef.current && !chatLoadingHistory) {
      const anchor = historyAnchorRef.current;
      historyAnchorRef.current = null;
      const deltaHeight = listNode.scrollHeight - anchor.height;
      listNode.scrollTop = anchor.top + deltaHeight;
      return;
    }

    const latestMessageId = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1].id : null;
    const hasNewLatestMessage =
      latestMessageId !== null && latestMessageId !== lastRenderedMessageIdRef.current;

    if (hasNewLatestMessage) {
      listNode.scrollTop = listNode.scrollHeight;
      isAtBottomRef.current = true;
    }

    lastRenderedMessageIdRef.current = latestMessageId;
  }, [chatLoadingHistory, chatMessages]);

  const renderMessage = (message: ChatMessage) => {
    const isSelf = message.sender.playerId === player?.id;

    return (
      <article
        key={message.id}
        data-testid={
          message.kind === "VOICE"
            ? isSelf
              ? "chat-voice-item-self"
              : "chat-voice-item-other"
            : isSelf
              ? "chat-text-item-self"
              : "chat-text-item-other"
        }
        data-message-kind={message.kind}
        data-message-self={isSelf ? "self" : "other"}
        className={`chat-panel__item ${isSelf ? "chat-panel__item--self" : ""} ${message.kind === "VOICE" ? "chat-panel__item--voice" : ""}`.trim()}
      >
        <header className="chat-panel__meta">
          <span className="chat-panel__sender">
            {message.sender.playerEmoji ? `${message.sender.playerEmoji} ` : ""}
            {message.sender.playerName}
          </span>
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {formatRelativeTime(message.createdAt, locale, relativeNow)}
          </time>
        </header>

        {message.kind === "TEXT" ? (
          <p className="chat-panel__bubble">{message.text}</p>
        ) : (
          <div className="chat-panel__bubble--voice" data-testid="chat-voice-bubble">
            <VoicePlaybackBar
              sourceUrl={resolveVoiceAudioUrl(message.voice.audioUrl)}
              durationMs={message.voice.durationMs}
              playLabel={t("game.chat.voice.play")}
              stopLabel={t("game.chat.voice.pause")}
              testId="chat-voice-player"
            />
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="chat-panel" data-testid="chat-panel">
      <header className="chat-panel__header">
        <h3>{t("game.chat.title")}</h3>
        <button
          type="button"
          onClick={onClose}
          data-testid="close-chat-button"
          className="chat-panel__close"
        >
          {t("common.close")}
        </button>
      </header>

      <div
        ref={listRef}
        className="chat-panel__messages"
        onScroll={handleScroll}
        data-testid="chat-message-list"
      >
        {chatLoadingHistory && (
          <p className="chat-panel__loading">{t("game.chat.loadingHistory")}</p>
        )}

        {chatMessages.length === 0 ? (
          <p className="chat-panel__empty">{t("game.chat.empty")}</p>
        ) : (
          chatMessages.map((message) => renderMessage(message))
        )}
      </div>

      <div className="chat-panel__composer" data-testid="chat-composer">
        {chatError && <p className="chat-panel__error">{chatError}</p>}

        <p className="chat-panel__recording-hint">
          {isRecording
            ? t("game.chat.record.recording", { seconds: recordingSeconds })
            : t("game.chat.record.shortcut")}
        </p>

        <form onSubmit={handleSubmitText} className="chat-panel__text-form">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("game.chat.placeholder")}
            className="chat-panel__input"
            maxLength={300}
            data-testid="chat-text-input"
          />
          <button
            type="button"
            onPointerDown={handleVoicePointerDown}
            onPointerUp={handleVoicePointerUp}
            onPointerCancel={handleVoicePointerCancel}
            onPointerLeave={handleVoicePointerLeave}
            disabled={isUploadingVoice}
            data-testid="chat-voice-hold-button"
            className={`chat-panel__voice-button chat-panel__voice-button--compact ${isRecording ? "chat-panel__voice-button--recording" : ""}`}
            aria-label={isRecording ? t("game.chat.record.release") : t("game.chat.record.hold")}
            title={isRecording ? t("game.chat.record.release") : t("game.chat.record.hold")}
          >
            <span className="chat-panel__voice-button-icon" aria-hidden="true">🎙</span>
          </button>
        </form>
      </div>
    </section>
  );
};
