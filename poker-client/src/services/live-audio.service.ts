import { Room, RoomEvent } from "livekit-client";
import { resolveServerResourceUrl } from "./socket.service";

export type LiveAudioParticipant = {
  identity: string;
  displayName: string;
  avatarEmoji: string | null;
  isLocal: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
};

export type LiveAudioState = {
  isConfigLoaded: boolean;
  available: boolean;
  serverUrl: string | null;
  isConnecting: boolean;
  isJoined: boolean;
  isMuted: boolean;
  isReconnecting: boolean;
  joinedRoomId: string | null;
  participants: LiveAudioParticipant[];
  error: string | null;
};

export type LiveAudioPublicConfig = {
  enabled: boolean;
  serverUrl?: string;
};

export type LiveAudioJoinPayload = {
  enabled: boolean;
  serverUrl: string;
  roomName: string;
  participantIdentity: string;
  participantName: string;
  participantMetadata: string;
  token: string;
};

export interface LiveAudioRoomParticipant {
  identity: string;
  name?: string;
  metadata?: string;
  isMicrophoneEnabled: boolean;
}

export interface LiveAudioRoom {
  localParticipant: LiveAudioRoomParticipant & {
    setMicrophoneEnabled(enabled: boolean): Promise<void>;
  };
  remoteParticipants: Map<string, LiveAudioRoomParticipant>;
  activeSpeakers: LiveAudioRoomParticipant[];
  prepareConnection(url: string, token?: string): Promise<void> | void;
  connect(url: string, token: string): Promise<void>;
  disconnect(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}

type LiveAudioControllerDeps = {
  loadConfig: () => Promise<LiveAudioPublicConfig>;
  requestJoinToken: (roomId: string) => Promise<LiveAudioJoinPayload>;
  createRoom: () => LiveAudioRoom;
  onStateChange?: (nextState: LiveAudioState) => void;
};

export const INITIAL_LIVE_AUDIO_STATE: LiveAudioState = {
  isConfigLoaded: false,
  available: false,
  serverUrl: null,
  isConnecting: false,
  isJoined: false,
  isMuted: true,
  isReconnecting: false,
  joinedRoomId: null,
  participants: [],
  error: null,
};

const normalizeRoomId = (roomId: string) => roomId.trim().toUpperCase();

const parseParticipantMetadata = (
  metadata: string | undefined,
): { displayName?: string; avatarEmoji?: string } => {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata) as {
      displayName?: string;
      avatarEmoji?: string;
    };

    return {
      displayName:
        typeof parsed.displayName === "string" ? parsed.displayName : undefined,
      avatarEmoji:
        typeof parsed.avatarEmoji === "string" ? parsed.avatarEmoji : undefined,
    };
  } catch {
    return {};
  }
};

const toParticipantState = (
  participant: LiveAudioRoomParticipant,
  activeSpeakerIds: Set<string>,
  localIdentity: string | null,
): LiveAudioParticipant => {
  const metadata = parseParticipantMetadata(participant.metadata);

  return {
    identity: participant.identity,
    displayName:
      metadata.displayName ||
      participant.name ||
      participant.identity.split(":").pop() ||
      participant.identity,
    avatarEmoji: metadata.avatarEmoji ?? null,
    isLocal: participant.identity === localIdentity,
    isMuted: !participant.isMicrophoneEnabled,
    isSpeaking: activeSpeakerIds.has(participant.identity),
  };
};

const toLiveAudioError = (error: unknown): string => {
  if (error instanceof Error) {
    const normalizedName = error.name.toLowerCase();
    const normalizedMessage = error.message.toLowerCase();
    if (
      normalizedName.includes("notallowed") ||
      normalizedMessage.includes("permission") ||
      normalizedMessage.includes("denied")
    ) {
      return "game.audio.error.microphoneDenied";
    }
    if (
      normalizedName.includes("notfound") ||
      normalizedMessage.includes("no microphone") ||
      normalizedMessage.includes("device not found")
    ) {
      return "game.audio.error.microphoneMissing";
    }
    if (normalizedName.includes("notreadable")) {
      return "game.audio.error.microphoneBusy";
    }
    return error.message || "game.audio.error.unavailable";
  }

  return "game.audio.error.unavailable";
};

const requestJson = async <T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(resolveServerResourceUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }

  return payload;
};

export const liveAudioApi = {
  async getConfig(): Promise<LiveAudioPublicConfig> {
    return requestJson<LiveAudioPublicConfig>("/api/live-audio/config");
  },

  async createJoinToken(roomId: string): Promise<LiveAudioJoinPayload> {
    return requestJson<LiveAudioJoinPayload>("/api/live-audio/token", {
      method: "POST",
      body: { roomId },
    });
  },
};

export const createLiveAudioController = (deps: LiveAudioControllerDeps) => {
  let state = { ...INITIAL_LIVE_AUDIO_STATE };
  let room: LiveAudioRoom | null = null;
  let localIdentity: string | null = null;
  let roomListenersCleanup: (() => void) | null = null;
  const subscribers = new Set<(nextState: LiveAudioState) => void>();

  const emit = () => {
    for (const subscriber of subscribers) {
      subscriber(state);
    }
    deps.onStateChange?.(state);
  };

  const patchState = (patch: Partial<LiveAudioState>) => {
    state = {
      ...state,
      ...patch,
    };
    emit();
  };

  const syncParticipantsFromRoom = () => {
    if (!room) {
      patchState({
        isMuted: true,
        participants: [],
      });
      return;
    }

    const activeSpeakerIds = new Set(
      room.activeSpeakers.map((participant) => participant.identity),
    );
    const nextParticipants = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ].map((participant) =>
      toParticipantState(participant, activeSpeakerIds, localIdentity),
    );

    patchState({
      participants: nextParticipants,
      isMuted: !room.localParticipant.isMicrophoneEnabled,
    });
  };

  const clearRoom = () => {
    roomListenersCleanup?.();
    roomListenersCleanup = null;
    room?.disconnect();
    room = null;
    localIdentity = null;
  };

  const bindRoom = (nextRoom: LiveAudioRoom) => {
    room = nextRoom;
    const sync = () => syncParticipantsFromRoom();
    const reconnecting = () => {
      patchState({
        isReconnecting: true,
      });
      sync();
    };
    const reconnected = () => {
      patchState({
        isReconnecting: false,
        error: null,
      });
      sync();
    };
    const disconnected = () => {
      clearRoom();
      patchState({
        isConnecting: false,
        isJoined: false,
        isMuted: true,
        isReconnecting: false,
        joinedRoomId: null,
        participants: [],
      });
    };

    const syncEvents = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ConnectionStateChanged,
    ] as const;

    for (const event of syncEvents) {
      nextRoom.on(event, sync);
    }
    nextRoom.on(RoomEvent.Reconnecting, reconnecting);
    nextRoom.on(RoomEvent.Reconnected, reconnected);
    nextRoom.on(RoomEvent.MediaDevicesError, (error) => {
      patchState({
        error: toLiveAudioError(error),
      });
    });
    nextRoom.on(RoomEvent.Disconnected, disconnected);

    roomListenersCleanup = () => {
      for (const event of syncEvents) {
        nextRoom.off(event, sync);
      }
      nextRoom.off(RoomEvent.Reconnecting, reconnecting);
      nextRoom.off(RoomEvent.Reconnected, reconnected);
      nextRoom.off(RoomEvent.Disconnected, disconnected);
    };
  };

  const refreshConfig = async () => {
    const config = await deps.loadConfig();

    patchState({
      isConfigLoaded: true,
      available: Boolean(config.enabled),
      serverUrl: config.enabled ? config.serverUrl || null : null,
    });

    return config;
  };

  return {
    subscribe(listener: (nextState: LiveAudioState) => void) {
      subscribers.add(listener);
      listener(state);

      return () => {
        subscribers.delete(listener);
      };
    },

    getState() {
      return state;
    },

    async refreshConfig() {
      try {
        return await refreshConfig();
      } catch (error) {
        patchState({
          isConfigLoaded: true,
          available: false,
          serverUrl: null,
          error: toLiveAudioError(error),
        });
        throw error;
      }
    },

    async join(roomId: string) {
      const normalizedRoomId = normalizeRoomId(roomId);
      if (!normalizedRoomId) {
        patchState({
          error: "game.audio.error.unavailable",
        });
        return;
      }

      if (!state.isConfigLoaded) {
        await refreshConfig();
      }
      if (!state.available) {
        patchState({
          error: null,
        });
        return;
      }
      if (state.isJoined && state.joinedRoomId === normalizedRoomId) {
        return;
      }

      clearRoom();
      patchState({
        isConnecting: true,
        isJoined: false,
        isReconnecting: false,
        joinedRoomId: normalizedRoomId,
        participants: [],
        error: null,
      });

      try {
        const joinPayload = await deps.requestJoinToken(normalizedRoomId);
        const nextRoom = deps.createRoom();
        localIdentity = joinPayload.participantIdentity;
        bindRoom(nextRoom);
        await nextRoom.prepareConnection(joinPayload.serverUrl, joinPayload.token);
        await nextRoom.connect(joinPayload.serverUrl, joinPayload.token);
        if (nextRoom.localParticipant.isMicrophoneEnabled) {
          await nextRoom.localParticipant.setMicrophoneEnabled(false);
        }
        patchState({
          isConfigLoaded: true,
          available: true,
          serverUrl: joinPayload.serverUrl,
          isConnecting: false,
          isJoined: true,
          joinedRoomId: normalizedRoomId,
          error: null,
        });
        syncParticipantsFromRoom();
      } catch (error) {
        clearRoom();
        patchState({
          isConnecting: false,
          isJoined: false,
          isMuted: true,
          isReconnecting: false,
          participants: [],
          error: toLiveAudioError(error),
        });
      }
    },

    async leave() {
      clearRoom();
      patchState({
        isConnecting: false,
        isJoined: false,
        isMuted: true,
        isReconnecting: false,
        joinedRoomId: null,
        participants: [],
        error: null,
      });
    },

    async setMuted(muted: boolean) {
      if (!room) {
        return;
      }

      try {
        await room.localParticipant.setMicrophoneEnabled(!muted);
        patchState({
          error: null,
        });
        syncParticipantsFromRoom();
      } catch (error) {
        patchState({
          error: toLiveAudioError(error),
        });
      }
    },

    clearError() {
      patchState({
        error: null,
      });
    },

    async dispose() {
      await this.leave();
      subscribers.clear();
    },
  };
};

export const createDefaultLiveAudioController = (
  options: {
    onStateChange?: (nextState: LiveAudioState) => void;
  } = {},
) =>
  createLiveAudioController({
    loadConfig: () => liveAudioApi.getConfig(),
    requestJoinToken: (roomId: string) => liveAudioApi.createJoinToken(roomId),
    createRoom: () =>
      new Room({
        adaptiveStream: true,
        dynacast: true,
      }) as unknown as LiveAudioRoom,
    onStateChange: options.onStateChange,
  });
