import { BadRequestException } from '@nestjs/common';
import { ChatService } from '../../src/chat/chat.service';

describe('ChatService', () => {
  let chatService: ChatService;
  let storageService: any;
  let chatMediaStorageService: any;

  beforeEach(() => {
    storageService = {
      getRoom: jest.fn().mockResolvedValue({
        id: 'ROOM1',
        players: [
          {
            id: 'player-1',
            name: 'Alice',
          },
        ],
      }),
      saveRoom: jest.fn(),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(),
      roomExists: jest.fn(),
    };

    chatMediaStorageService = {
      saveVoiceClip: jest.fn().mockImplementation(async (input: any) => ({
        audioUrl: '/uploads/chat-audio/ROOM1/voice.webm',
        sizeBytes: input.fileBuffer.byteLength,
        mimeType: input.mimeType,
      })),
      deleteRoomMedia: jest.fn(),
      pruneOrphanMedia: jest.fn(),
    };

    chatService = new ChatService(storageService, chatMediaStorageService);
  });

  it('accepts codec-qualified mime type and normalizes to base mime type', async () => {
    const result = await chatService.uploadVoiceClip({
      roomId: 'ROOM1',
      playerId: 'player-1',
      durationMs: 1200,
      file: {
        buffer: Buffer.from('voice-bytes'),
        size: 11,
        mimetype: 'audio/webm;codecs=opus',
        originalname: 'voice.webm',
      },
    });

    expect(chatMediaStorageService.saveVoiceClip).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'audio/webm',
      }),
    );
    expect(result.mimeType).toBe('audio/webm');
  });

  it('rejects unsupported mime type', async () => {
    await expect(
      chatService.uploadVoiceClip({
        roomId: 'ROOM1',
        playerId: 'player-1',
        durationMs: 1200,
        file: {
          buffer: Buffer.from('voice-bytes'),
          size: 11,
          mimetype: 'video/mp4',
          originalname: 'voice.mp4',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
