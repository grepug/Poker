import { RoomEvent } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import {
  createLiveAudioController,
  type LiveAudioRoom,
  type LiveAudioRoomParticipant,
} from "./live-audio.service";

class FakeParticipant implements LiveAudioRoomParticipant {
  identity: string;
  name: string;
  metadata?: string;
  isMicrophoneEnabled: boolean;
  setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
    this.isMicrophoneEnabled = enabled;
  });

  constructor(input: {
    identity: string;
    name: string;
    metadata?: string;
    isMicrophoneEnabled?: boolean;
  }) {
    this.identity = input.identity;
    this.name = input.name;
    this.metadata = input.metadata;
    this.isMicrophoneEnabled = input.isMicrophoneEnabled ?? false;
  }
}

class FakeRoom implements LiveAudioRoom {
  localParticipant: FakeParticipant;
  remoteParticipants = new Map<string, FakeParticipant>();
  activeSpeakers: LiveAudioRoomParticipant[] = [];
  connect = vi.fn(async () => undefined);
  prepareConnection = vi.fn(async () => undefined);
  disconnect = vi.fn(() => undefined);
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(localParticipant: FakeParticipant) {
    this.localParticipant = localParticipant;
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

describe("createLiveAudioController", () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalSecureContextDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "isSecureContext",
  );
  const joinPayload = {
    enabled: true,
    serverUrl: "wss://poker-16h0u738.livekit.cloud",
    roomName: "poker-room-ROOM83",
    participantIdentity: "user-1:player-1",
    participantName: "Alice",
    participantMetadata: JSON.stringify({
      roomId: "ROOM83",
      playerId: "player-1",
      userId: "user-1",
      displayName: "Alice",
      avatarEmoji: "🦊",
    }),
    token: "jwt-token",
  } as const;

  it("surfaces disabled config without creating a room", async () => {
    const createRoom = vi.fn();
    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({ enabled: false })),
      requestJoinToken: vi.fn(),
      createRoom,
    });

    await controller.refreshConfig();

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        isConfigLoaded: true,
        available: false,
        isJoined: false,
      }),
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("joins a room, keeps the user muted by default, and tracks roster updates", async () => {
    const room = new FakeRoom(
      new FakeParticipant({
        identity: joinPayload.participantIdentity,
        name: joinPayload.participantName,
        metadata: joinPayload.participantMetadata,
        isMicrophoneEnabled: false,
      }),
    );
    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({
        enabled: true,
        serverUrl: joinPayload.serverUrl,
      })),
      requestJoinToken: vi.fn(async () => joinPayload),
      createRoom: vi.fn(() => room),
    });

    await controller.join("ROOM83");

    expect(room.prepareConnection).toHaveBeenCalledWith(
      joinPayload.serverUrl,
      joinPayload.token,
    );
    expect(room.connect).toHaveBeenCalledWith(
      joinPayload.serverUrl,
      joinPayload.token,
    );
    expect(controller.getState()).toEqual(
      expect.objectContaining({
        available: true,
        isJoined: true,
        isMuted: true,
        joinedRoomId: "ROOM83",
        participants: [
          expect.objectContaining({
            identity: joinPayload.participantIdentity,
            displayName: "Alice",
            avatarEmoji: "🦊",
            isLocal: true,
            isMuted: true,
            isSpeaking: false,
          }),
        ],
      }),
    );

    const remoteParticipant = new FakeParticipant({
      identity: "user-2:player-2",
      name: "Bob",
      metadata: JSON.stringify({
        roomId: "ROOM83",
        playerId: "player-2",
        userId: "user-2",
        displayName: "Bob",
        avatarEmoji: "🐻",
      }),
      isMicrophoneEnabled: true,
    });
    room.remoteParticipants.set(remoteParticipant.identity, remoteParticipant);
    room.activeSpeakers = [remoteParticipant];
    room.emit("participantConnected", remoteParticipant);
    room.emit("activeSpeakersChanged", room.activeSpeakers);

    expect(controller.getState().participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identity: "user-2:player-2",
          displayName: "Bob",
          avatarEmoji: "🐻",
          isLocal: false,
          isMuted: false,
          isSpeaking: true,
        }),
      ]),
    );
  });

  it("toggles microphone mute state through the active room", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      },
    });
    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value: true,
    });

    const localParticipant = new FakeParticipant({
      identity: joinPayload.participantIdentity,
      name: joinPayload.participantName,
      metadata: joinPayload.participantMetadata,
      isMicrophoneEnabled: false,
    });
    const room = new FakeRoom(localParticipant);
    const setMicrophoneEnabled = room.localParticipant.setMicrophoneEnabled;

    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({
        enabled: true,
        serverUrl: joinPayload.serverUrl,
      })),
      requestJoinToken: vi.fn(async () => joinPayload),
      createRoom: vi.fn(() => room),
    });

    try {
      await controller.join("ROOM83");
      await controller.setMuted(false);
      expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
      expect(controller.getState().isMuted).toBe(false);

      await controller.setMuted(true);
      expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
      expect(controller.getState().isMuted).toBe(true);
    } finally {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete (globalThis as Record<string, unknown>).navigator;
      }

      if (originalSecureContextDescriptor) {
        Object.defineProperty(
          globalThis,
          "isSecureContext",
          originalSecureContextDescriptor,
        );
      } else {
        delete (globalThis as Record<string, unknown>).isSecureContext;
      }
    }
  });

  it("disconnects the previous room during leave and before rejoining a different room", async () => {
    const firstRoom = new FakeRoom(
      new FakeParticipant({
        identity: joinPayload.participantIdentity,
        name: joinPayload.participantName,
        metadata: joinPayload.participantMetadata,
      }),
    );
    const secondRoom = new FakeRoom(
      new FakeParticipant({
        identity: joinPayload.participantIdentity,
        name: joinPayload.participantName,
        metadata: joinPayload.participantMetadata,
      }),
    );
    const createRoom = vi
      .fn<() => LiveAudioRoom>()
      .mockImplementationOnce(() => firstRoom)
      .mockImplementationOnce(() => secondRoom);

    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({
        enabled: true,
        serverUrl: joinPayload.serverUrl,
      })),
      requestJoinToken: vi.fn(async (roomId: string) => ({
        ...joinPayload,
        roomName: `poker-room-${roomId}`,
      })),
      createRoom,
    });

    await controller.join("ROOM83");
    await controller.leave();

    expect(firstRoom.disconnect).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual(
      expect.objectContaining({
        isJoined: false,
        participants: [],
        joinedRoomId: null,
      }),
    );

    await controller.join("ROOM84");
    expect(secondRoom.connect).toHaveBeenCalledTimes(1);
    expect(controller.getState().joinedRoomId).toBe("ROOM84");
  });

  it("returns a secure-context error when the browser does not expose getUserMedia", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value: false,
    });

    const localParticipant = new FakeParticipant({
      identity: joinPayload.participantIdentity,
      name: joinPayload.participantName,
      metadata: joinPayload.participantMetadata,
      isMicrophoneEnabled: false,
    });
    const room = new FakeRoom(localParticipant);

    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({
        enabled: true,
        serverUrl: joinPayload.serverUrl,
      })),
      requestJoinToken: vi.fn(async () => joinPayload),
      createRoom: vi.fn(() => room),
    });

    try {
      await controller.join("ROOM83");
      await controller.setMuted(false);

      expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
      expect(controller.getState().error).toBe(
        "game.audio.error.microphoneRequiresSecureContext",
      );
    } finally {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete (globalThis as Record<string, unknown>).navigator;
      }

      if (originalSecureContextDescriptor) {
        Object.defineProperty(
          globalThis,
          "isSecureContext",
          originalSecureContextDescriptor,
        );
      } else {
        delete (globalThis as Record<string, unknown>).isSecureContext;
      }
    }
  });

  it("clears joinedRoomId when joining fails", async () => {
    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({
        enabled: true,
        serverUrl: joinPayload.serverUrl,
      })),
      requestJoinToken: vi.fn(async () => {
        throw new Error("join failed");
      }),
      createRoom: vi.fn(),
    });

    await controller.join("ROOM83");

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        isJoined: false,
        joinedRoomId: null,
        error: "join failed",
      }),
    );
  });

  it("removes the media-devices error listener when leaving a room", async () => {
    const room = new FakeRoom(
      new FakeParticipant({
        identity: joinPayload.participantIdentity,
        name: joinPayload.participantName,
        metadata: joinPayload.participantMetadata,
      }),
    );
    const controller = createLiveAudioController({
      loadConfig: vi.fn(async () => ({
        enabled: true,
        serverUrl: joinPayload.serverUrl,
      })),
      requestJoinToken: vi.fn(async () => joinPayload),
      createRoom: vi.fn(() => room),
    });

    await controller.join("ROOM83");
    expect(room.listenerCount(RoomEvent.MediaDevicesError)).toBeGreaterThan(0);

    await controller.leave();

    expect(room.listenerCount(RoomEvent.MediaDevicesError)).toBe(0);
  });
});
