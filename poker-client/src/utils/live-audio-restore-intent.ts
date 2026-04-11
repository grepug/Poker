export type LiveAudioRestoreIntent = {
  roomId: string;
  muted: boolean;
};

export type LiveAudioRestoreEligibility = {
  isAuthInitializing: boolean;
  isAuthenticated: boolean;
  hasUser: boolean;
  roomId: string | null;
  isRecoveringSession: boolean;
  isJoined: boolean;
  joinedRoomId: string | null;
  isConnecting: boolean;
  promptedRoomId: string | null;
  storedIntent: LiveAudioRestoreIntent | null;
};

const LIVE_AUDIO_RESTORE_INTENT_STORAGE_KEY = "poker.liveAudioRestoreIntent";

export const normalizeLiveAudioRoomId = (roomId: string) =>
  roomId.trim().toUpperCase();

export const readStoredLiveAudioRestoreIntent =
  (): LiveAudioRestoreIntent | null => {
    if (typeof window === "undefined") {
      return null;
    }

    const raw = window.sessionStorage.getItem(
      LIVE_AUDIO_RESTORE_INTENT_STORAGE_KEY,
    );
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<LiveAudioRestoreIntent>;
      if (typeof parsed.roomId !== "string" || !parsed.roomId) {
        return null;
      }
      if (typeof parsed.muted !== "boolean") {
        return null;
      }

      return {
        roomId: normalizeLiveAudioRoomId(parsed.roomId),
        muted: parsed.muted,
      };
    } catch {
      return null;
    }
  };

export const writeStoredLiveAudioRestoreIntent = (
  intent: LiveAudioRestoreIntent,
) => {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    LIVE_AUDIO_RESTORE_INTENT_STORAGE_KEY,
    JSON.stringify({
      roomId: normalizeLiveAudioRoomId(intent.roomId),
      muted: intent.muted,
    }),
  );
};

export const clearStoredLiveAudioRestoreIntent = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(LIVE_AUDIO_RESTORE_INTENT_STORAGE_KEY);
};

export const shouldOfferLiveAudioReconnect = ({
  isAuthInitializing,
  isAuthenticated,
  hasUser,
  roomId,
  isRecoveringSession,
  isJoined,
  joinedRoomId,
  isConnecting,
  promptedRoomId,
  storedIntent,
}: LiveAudioRestoreEligibility): boolean => {
  if (isAuthInitializing || isRecoveringSession) {
    return false;
  }
  if (!isAuthenticated || !hasUser || !roomId || !storedIntent) {
    return false;
  }
  if (storedIntent.roomId !== normalizeLiveAudioRoomId(roomId)) {
    return false;
  }
  if (isConnecting || isJoined) {
    return false;
  }
  if (
    joinedRoomId &&
    normalizeLiveAudioRoomId(joinedRoomId) !== normalizeLiveAudioRoomId(roomId)
  ) {
    return false;
  }
  return promptedRoomId !== normalizeLiveAudioRoomId(roomId);
};
