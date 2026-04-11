/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { useGame } from "./GameContext";
import {
  INITIAL_LIVE_AUDIO_STATE,
  createDefaultLiveAudioController,
  type LiveAudioState,
} from "@/services/live-audio.service";
import {
  clearStoredLiveAudioRestoreIntent,
  type LiveAudioRestoreIntent,
  normalizeLiveAudioRoomId,
  readStoredLiveAudioRestoreIntent,
  shouldOfferLiveAudioReconnect,
  writeStoredLiveAudioRestoreIntent,
} from "@/utils/live-audio-restore-intent";

type LiveAudioContextValue = LiveAudioState & {
  hasReconnectPrompt: boolean;
  joinAudio: () => Promise<void>;
  reconnectAudio: () => Promise<void>;
  dismissReconnectPrompt: () => void;
  leaveAudio: () => Promise<void>;
  muteAudio: () => Promise<void>;
  unmuteAudio: () => Promise<void>;
  enableAudio: () => Promise<void>;
  clearError: () => void;
};

const LiveAudioContext = createContext<LiveAudioContextValue | null>(null);
const ACTIVE_ROOM_SESSION_STORAGE_KEY = "poker.activeSession";

const hasStoredActiveRoomSession = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(window.sessionStorage.getItem(ACTIVE_ROOM_SESSION_STORAGE_KEY));
};

export const useLiveAudio = () => {
  const context = useContext(LiveAudioContext);
  if (!context) {
    throw new Error("useLiveAudio must be used within LiveAudioProvider");
  }
  return context;
};

export const LiveAudioProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { user, isAuthenticated, isInitializing } = useAuth();
  const { room, isRecoveringSession } = useGame();
  const [state, setState] = useState<LiveAudioState>(INITIAL_LIVE_AUDIO_STATE);
  const controllerRef = useRef(
    createDefaultLiveAudioController({
      onStateChange: setState,
    }),
  );
  const reconnectPromptedRoomIdRef = useRef<string | null>(null);
  const [pendingReconnectIntent, setPendingReconnectIntent] =
    useState<LiveAudioRestoreIntent | null>(null);
  const roomId = room?.id ? normalizeLiveAudioRoomId(room.id) : null;

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    if (!isAuthenticated || !user) {
      clearStoredLiveAudioRestoreIntent();
      reconnectPromptedRoomIdRef.current = null;
      setPendingReconnectIntent(null);
      void controllerRef.current.leave();
      return;
    }

    void controllerRef.current.refreshConfig().catch(() => undefined);
  }, [isAuthenticated, isInitializing, user?.id]);

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    if (isRecoveringSession) {
      return;
    }

    if (!roomId) {
      if (hasStoredActiveRoomSession()) {
        return;
      }

      clearStoredLiveAudioRestoreIntent();
      reconnectPromptedRoomIdRef.current = null;
      setPendingReconnectIntent(null);
      if (state.isJoined || state.joinedRoomId) {
        void controllerRef.current.leave();
      }
      return;
    }

    const storedIntent = readStoredLiveAudioRestoreIntent();
    if (storedIntent && storedIntent.roomId !== roomId) {
      clearStoredLiveAudioRestoreIntent();
      setPendingReconnectIntent(null);
    }

    if (
      state.isJoined &&
      state.joinedRoomId &&
      state.joinedRoomId !== roomId
    ) {
      clearStoredLiveAudioRestoreIntent();
      reconnectPromptedRoomIdRef.current = null;
      setPendingReconnectIntent(null);
      void controllerRef.current.leave();
    }
  }, [
    isInitializing,
    isRecoveringSession,
    roomId,
    state.isJoined,
    state.joinedRoomId,
  ]);

  useEffect(() => {
    if (room?.gameState === "ENDED" && state.isJoined) {
      clearStoredLiveAudioRestoreIntent();
      reconnectPromptedRoomIdRef.current = null;
      setPendingReconnectIntent(null);
      void controllerRef.current.leave();
    }
  }, [room?.gameState, state.isJoined]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    if (state.isJoined && state.joinedRoomId === roomId) {
      writeStoredLiveAudioRestoreIntent({
        roomId,
        muted: state.isMuted,
      });
      setPendingReconnectIntent(null);
      return;
    }

    if (!state.isJoined && !isRecoveringSession) {
      const storedIntent = readStoredLiveAudioRestoreIntent();
      if (storedIntent?.roomId !== roomId) {
        reconnectPromptedRoomIdRef.current = null;
        setPendingReconnectIntent(null);
      }
    }
  }, [isRecoveringSession, roomId, state.isJoined, state.isMuted, state.joinedRoomId]);

  useEffect(() => {
    const storedIntent = readStoredLiveAudioRestoreIntent();
    if (
      !shouldOfferLiveAudioReconnect({
        isAuthInitializing: isInitializing,
        isAuthenticated,
        hasUser: Boolean(user),
        roomId,
        isRecoveringSession,
        isJoined: state.isJoined,
        joinedRoomId: state.joinedRoomId,
        isConnecting: state.isConnecting,
        promptedRoomId: reconnectPromptedRoomIdRef.current,
        storedIntent,
      })
    ) {
      if (
        !storedIntent ||
        storedIntent.roomId !== roomId ||
        state.isJoined ||
        state.isConnecting
      ) {
        setPendingReconnectIntent(null);
      }
      return;
    }

    if (!roomId || !storedIntent) {
      return;
    }

    reconnectPromptedRoomIdRef.current = roomId;
    setPendingReconnectIntent(storedIntent);
  }, [
    isAuthenticated,
    isInitializing,
    isRecoveringSession,
    roomId,
    state.isConnecting,
    state.isJoined,
    state.joinedRoomId,
    user,
  ]);

  const joinRoomAudio = async (
    nextRoomId: string,
    intent: LiveAudioRestoreIntent | null,
  ) => {
    await controllerRef.current.join(nextRoomId);
    if (intent?.muted) {
      await controllerRef.current.setMuted(true);
    }
  };

  useEffect(() => {
    return () => {
      void controllerRef.current.dispose();
    };
  }, []);

  const value = useMemo<LiveAudioContextValue>(
    () => ({
      ...state,
      hasReconnectPrompt:
        !state.isJoined &&
        !state.isConnecting &&
        pendingReconnectIntent?.roomId === roomId,
      joinAudio: async () => {
        if (!room?.id) {
          return;
        }
        await joinRoomAudio(room.id, null);
      },
      reconnectAudio: async () => {
        if (!roomId || pendingReconnectIntent?.roomId !== roomId) {
          return;
        }

        setPendingReconnectIntent(null);
        await joinRoomAudio(roomId, pendingReconnectIntent);
      },
      dismissReconnectPrompt: () => {
        clearStoredLiveAudioRestoreIntent();
        reconnectPromptedRoomIdRef.current = roomId;
        setPendingReconnectIntent(null);
      },
      leaveAudio: async () => {
        clearStoredLiveAudioRestoreIntent();
        reconnectPromptedRoomIdRef.current = null;
        setPendingReconnectIntent(null);
        await controllerRef.current.leave();
      },
      muteAudio: async () => {
        await controllerRef.current.setMuted(true);
      },
      unmuteAudio: async () => {
        await controllerRef.current.setMuted(false);
      },
      enableAudio: async () => {
        await controllerRef.current.enableAudio();
      },
      clearError: () => {
        controllerRef.current.clearError();
      },
    }),
    [pendingReconnectIntent, room?.id, roomId, state],
  );

  return (
    <LiveAudioContext.Provider value={value}>
      {children}
    </LiveAudioContext.Provider>
  );
};
