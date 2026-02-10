import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "poker-types";
import { useLocalization } from "../contexts/LocalizationContext";
import { useGame } from "../contexts/GameContext";
import { resolveServerBaseUrl } from "../services/socket.service";

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

const resolveAudioUrl = (audioUrl: string): string => {
  if (audioUrl.startsWith("http://") || audioUrl.startsWith("https://")) {
    return audioUrl;
  }

  return `${resolveServerBaseUrl()}${audioUrl}`;
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

const formatMessageTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
  const { t } = useLocalization();
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
  const textInputRef = useRef<HTMLInputElement | null>(null);
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

        const response = await fetch(`${resolveServerBaseUrl()}/api/chat/voice-upload`, {
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

  const handleSubmitText = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextText = draft.trim();
      if (!nextText) {
        return;
      }

      sendChatText(nextText);
      setDraft("");
      textInputRef.current?.focus();
    },
    [draft, sendChatText],
  );

  const handleScroll = useCallback(() => {
    const listNode = listRef.current;
    if (!listNode) {
      return;
    }

    const isNearBottom =
      listNode.scrollHeight - listNode.scrollTop - listNode.clientHeight < 96;
    isAtBottomRef.current = isNearBottom;

    if (
      listNode.scrollTop <= 48 &&
      chatHasMore &&
      !chatLoadingHistory
    ) {
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

    if (isAtBottomRef.current || chatMessages.length <= 1) {
      listNode.scrollTop = listNode.scrollHeight;
    }
  }, [chatLoadingHistory, chatMessages]);

  const canSendText = useMemo(
    () => draft.trim().length > 0 && !isUploadingVoice,
    [draft, isUploadingVoice],
  );

  const renderMessage = (message: ChatMessage) => {
    const isSelf = message.sender.playerId === player?.id;

    return (
      <article
        key={message.id}
        className={`chat-panel__item ${isSelf ? "chat-panel__item--self" : ""}`}
      >
        <header className="chat-panel__meta">
          <span className="chat-panel__sender">
            {message.sender.playerEmoji ? `${message.sender.playerEmoji} ` : ""}
            {message.sender.playerName}
          </span>
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {formatMessageTime(message.createdAt)}
          </time>
        </header>

        {message.kind === "TEXT" ? (
          <p className="chat-panel__bubble">{message.text}</p>
        ) : (
          <div className="chat-panel__bubble chat-panel__bubble--voice">
            <span className="chat-panel__voice-label">{t("game.chat.voiceLabel")}</span>
            <audio controls preload="none" src={resolveAudioUrl(message.voice.audioUrl)} />
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

        <p className="chat-panel__shortcut">{t("game.chat.record.shortcut")}</p>

        <div className="chat-panel__voice-row">
          <button
            type="button"
            onPointerDown={() => void startRecording("touch")}
            onPointerUp={() => scheduleStopRecording(false)}
            onPointerCancel={() => scheduleStopRecording(true)}
            onPointerLeave={() => {
              if (recordingMode === "touch") {
                scheduleStopRecording(false);
              }
            }}
            disabled={isUploadingVoice}
            data-testid="chat-voice-hold-button"
            className={`chat-panel__voice-button ${isRecording ? "chat-panel__voice-button--recording" : ""}`}
          >
            {isRecording
              ? t("game.chat.record.release")
              : t("game.chat.record.hold")}
          </button>

          {isRecording && (
            <button
              type="button"
              onClick={() => stopRecordingNow(true)}
              className="chat-panel__voice-cancel"
              data-testid="chat-voice-cancel"
            >
              {t("common.cancel")}
            </button>
          )}
        </div>

        <p className="chat-panel__recording-hint">
          {isRecording
            ? t("game.chat.record.recording", { seconds: recordingSeconds })
            : t("game.chat.record.max", { seconds: VOICE_MAX_DURATION_MS / 1000 })}
        </p>

        <form onSubmit={handleSubmitText} className="chat-panel__text-form">
          <input
            ref={textInputRef}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("game.chat.placeholder")}
            className="chat-panel__input"
            maxLength={300}
            data-testid="chat-text-input"
          />
          <button
            type="submit"
            disabled={!canSendText}
            className="chat-panel__send"
            data-testid="chat-send-button"
          >
            {t("game.chat.send")}
          </button>
        </form>
      </div>
    </section>
  );
};
