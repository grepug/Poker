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

type LiveAudioContextValue = LiveAudioState & {
  joinAudio: () => Promise<void>;
  leaveAudio: () => Promise<void>;
  muteAudio: () => Promise<void>;
  unmuteAudio: () => Promise<void>;
  enableAudio: () => Promise<void>;
  clearError: () => void;
};

const LiveAudioContext = createContext<LiveAudioContextValue | null>(null);

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
  const { user, isAuthenticated } = useAuth();
  const { room } = useGame();
  const [state, setState] = useState<LiveAudioState>(INITIAL_LIVE_AUDIO_STATE);
  const controllerRef = useRef(
    createDefaultLiveAudioController({
      onStateChange: setState,
    }),
  );

  useEffect(() => {
    if (!isAuthenticated || !user) {
      void controllerRef.current.leave();
      return;
    }

    void controllerRef.current.refreshConfig().catch(() => undefined);
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!room?.id) {
      void controllerRef.current.leave();
      return;
    }

    if (
      state.isJoined &&
      state.joinedRoomId &&
      state.joinedRoomId !== room.id.toUpperCase()
    ) {
      void controllerRef.current.leave();
    }
  }, [room?.id, state.isJoined, state.joinedRoomId]);

  useEffect(() => {
    if (room?.gameState === "ENDED" && state.isJoined) {
      void controllerRef.current.leave();
    }
  }, [room?.gameState, state.isJoined]);

  useEffect(() => {
    return () => {
      void controllerRef.current.dispose();
    };
  }, []);

  const value = useMemo<LiveAudioContextValue>(
    () => ({
      ...state,
      joinAudio: async () => {
        if (!room?.id) {
          return;
        }
        await controllerRef.current.join(room.id);
      },
      leaveAudio: async () => {
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
    [room?.id, state],
  );

  return (
    <LiveAudioContext.Provider value={value}>
      {children}
    </LiveAudioContext.Provider>
  );
};
