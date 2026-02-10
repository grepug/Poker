import { EventsGateway } from '../../src/events/events.gateway';

describe('EventsGateway chat events', () => {
  let gateway: EventsGateway;
  let storageService: any;
  let chatStorageService: any;
  let chatMediaStorageService: any;
  let roomEmitter: { emit: jest.Mock };

  beforeEach(() => {
    roomEmitter = { emit: jest.fn() };

    storageService = {
      getRoom: jest.fn().mockResolvedValue({
        id: 'ROOM1',
        players: [
          {
            id: 'player-1',
            socketId: 'socket-1',
            name: 'Alice',
            emoji: '🦊',
          },
        ],
      }),
      saveRoom: jest.fn(),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(),
      roomExists: jest.fn(),
    };

    chatStorageService = {
      getMessagePage: jest.fn().mockResolvedValue({
        messages: [],
        hasMore: false,
        nextBeforeSeq: null,
      }),
      appendMessage: jest.fn().mockResolvedValue({
        duplicate: false,
        message: {
          id: 'msg-1',
          roomId: 'ROOM1',
          seq: 1,
          kind: 'TEXT',
          text: 'hello',
          sender: {
            playerId: 'player-1',
            playerName: 'Alice',
          },
          clientMessageId: 'chat-1',
          createdAt: Date.now(),
        },
      }),
      hasChatData: jest.fn(),
      deleteRoomChat: jest.fn(),
      listRoomsWithChatData: jest.fn().mockResolvedValue([]),
      pruneRoomMessages: jest.fn(),
    };

    chatMediaStorageService = {
      saveVoiceClip: jest.fn(),
      deleteRoomMedia: jest.fn(),
      pruneOrphanMedia: jest.fn(),
    };

    gateway = new EventsGateway(
      {} as any,
      {} as any,
      {} as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      storageService,
      chatStorageService,
      chatMediaStorageService,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      sockets: { sockets: new Map() },
    } as any;

    (gateway as any).socketToPlayer.set('socket-1', {
      roomId: 'ROOM1',
      playerId: 'player-1',
    });
  });

  it('broadcasts chat message and deduplicates repeated clientMessageId', async () => {
    const client = {
      id: 'socket-1',
      emit: jest.fn(),
    } as any;

    const first = await gateway.handleSendChatMessage(client, {
      kind: 'TEXT',
      text: 'hello',
      clientMessageId: 'chat-1',
    });

    expect(first.success).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(roomEmitter.emit).toHaveBeenCalledWith('CHAT_MESSAGE_ADDED', {
      message: expect.objectContaining({ id: 'msg-1' }),
    });

    const second = await gateway.handleSendChatMessage(client, {
      kind: 'TEXT',
      text: 'hello retry',
      clientMessageId: 'chat-1',
    });

    expect(second.success).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(chatStorageService.appendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns paginated history from storage', async () => {
    chatStorageService.getMessagePage.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-2',
          roomId: 'ROOM1',
          seq: 10,
          kind: 'TEXT',
          text: 'history',
          sender: {
            playerId: 'player-1',
            playerName: 'Alice',
          },
          createdAt: Date.now(),
        },
      ],
      hasMore: true,
      nextBeforeSeq: 10,
    });

    const response = await gateway.handleGetChatHistory(
      { id: 'socket-1' } as any,
      { limit: 1 },
    );

    expect(response.success).toBe(true);
    expect(response.messages).toHaveLength(1);
    expect(response.hasMore).toBe(true);
    expect(response.nextBeforeSeq).toBe(10);
  });

  it('normalizes codec-qualified voice mime type before persisting', async () => {
    chatStorageService.appendMessage.mockResolvedValueOnce({
      duplicate: false,
      message: {
        id: 'msg-voice-1',
        roomId: 'ROOM1',
        seq: 2,
        kind: 'VOICE',
        voice: {
          audioUrl: '/uploads/chat-audio/ROOM1/voice.webm',
          durationMs: 1200,
          sizeBytes: 1024,
          mimeType: 'audio/webm',
        },
        sender: {
          playerId: 'player-1',
          playerName: 'Alice',
        },
        clientMessageId: 'voice-1',
        createdAt: Date.now(),
      },
    });

    const response = await gateway.handleSendChatMessage(
      { id: 'socket-1', emit: jest.fn() } as any,
      {
        kind: 'VOICE',
        clientMessageId: 'voice-1',
        voice: {
          audioUrl: '/uploads/chat-audio/ROOM1/voice.webm',
          durationMs: 1200,
          sizeBytes: 1024,
          mimeType: 'audio/webm;codecs=opus',
        },
      },
    );

    expect(response.success).toBe(true);
    expect(chatStorageService.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'VOICE',
        voice: expect.objectContaining({
          mimeType: 'audio/webm',
        }),
      }),
    );
  });

  it('continues room action queue after a failed task', async () => {
    const runRoomActionSequentially = (gateway as any)
      .runRoomActionSequentially.bind(gateway) as <T>(
      roomId: string,
      task: () => Promise<T>,
    ) => Promise<T>;

    await expect(
      runRoomActionSequentially('ROOM1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(
      runRoomActionSequentially('ROOM1', async () => 'ok'),
    ).resolves.toBe('ok');
  });

});
