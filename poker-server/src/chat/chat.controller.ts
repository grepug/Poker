import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ChatService } from './chat.service';

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('voice-upload')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: {
        fileSize: Number(process.env.CHAT_VOICE_MAX_BYTES || `${2 * 1024 * 1024}`),
      },
    }),
  )
  async uploadVoice(
    @UploadedFile() file: any,
    @Body()
    body: {
      roomId?: string;
      playerId?: string;
      durationMs?: string | number;
    },
  ) {
    const durationRaw = body.durationMs;
    const durationMs =
      typeof durationRaw === 'number'
        ? durationRaw
        : Number.parseFloat(durationRaw || '0');

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new BadRequestException('durationMs must be provided');
    }

    const voice = await this.chatService.uploadVoiceClip({
      roomId: body.roomId || '',
      playerId: body.playerId || '',
      durationMs,
      file,
    });

    return {
      success: true,
      voice,
    };
  }
}
