import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IStorageService } from '../common/interfaces/storage.interface';
import { IChatMediaStorageService } from '../common/interfaces/chat-media-storage.interface';
import { VoiceMessagePayload } from 'poker-types';

@Injectable()
export class ChatService {
  private readonly maxVoiceDurationMs = Number(
    process.env.CHAT_VOICE_MAX_DURATION_MS || '60000',
  );
  private readonly maxVoiceBytes = Number(
    process.env.CHAT_VOICE_MAX_BYTES || `${2 * 1024 * 1024}`,
  );
  private readonly allowedVoiceMimeTypes = new Set([
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
  ]);

  constructor(
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
    @Inject('IChatMediaStorageService')
    private readonly chatMediaStorageService: IChatMediaStorageService,
  ) {}

  async uploadVoiceClip(params: {
    roomId: string;
    playerId: string;
    durationMs: number;
    file: {
      buffer: Buffer;
      size: number;
      mimetype: string;
      originalname?: string;
    };
  }): Promise<VoiceMessagePayload> {
    const roomId = params.roomId?.trim();
    const playerId = params.playerId?.trim();

    if (!roomId || !playerId) {
      throw new BadRequestException('roomId and playerId are required');
    }

    if (!Number.isFinite(params.durationMs) || params.durationMs <= 0) {
      throw new BadRequestException('durationMs must be a positive number');
    }

    if (params.durationMs > this.maxVoiceDurationMs) {
      throw new BadRequestException(
        `Voice message exceeds ${this.maxVoiceDurationMs}ms`,
      );
    }

    if (!params.file?.buffer?.byteLength) {
      throw new BadRequestException('Audio file is required');
    }

    const mimeType = params.file.mimetype?.trim().toLowerCase();
    if (!mimeType || !this.allowedVoiceMimeTypes.has(mimeType)) {
      throw new BadRequestException('Unsupported audio mime type');
    }

    if (params.file.size > this.maxVoiceBytes) {
      throw new BadRequestException(
        `Voice message exceeds ${this.maxVoiceBytes} bytes`,
      );
    }

    const room = await this.storageService.getRoom(roomId);
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new NotFoundException('Player not found in room');
    }

    const saved = await this.chatMediaStorageService.saveVoiceClip({
      roomId,
      playerId,
      fileBuffer: params.file.buffer,
      mimeType,
      originalName: params.file.originalname,
    });

    return {
      audioUrl: saved.audioUrl,
      durationMs: params.durationMs,
      sizeBytes: saved.sizeBytes,
      mimeType: saved.mimeType,
    };
  }
}
