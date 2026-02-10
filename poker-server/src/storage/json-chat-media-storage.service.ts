import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IChatMediaStorageService,
  PruneOrphanMediaResult,
  SaveVoiceClipInput,
  SaveVoiceClipResult,
} from '../common/interfaces/chat-media-storage.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class JsonChatMediaStorageService implements IChatMediaStorageService {
  private readonly logger = new Logger(JsonChatMediaStorageService.name);
  private readonly dataDir: string;
  private readonly chatAudioDir: string;

  constructor(private readonly configService: ConfigService) {
    this.dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.chatAudioDir = path.join(this.dataDir, 'chat-audio');

    this.ensureDirectories().catch((error) =>
      this.logger.error(
        `Failed to initialize chat media directory: ${error.message}`,
      ),
    );
  }

  async saveVoiceClip(input: SaveVoiceClipInput): Promise<SaveVoiceClipResult> {
    await this.ensureDirectories();

    const roomDirectory = this.getRoomDirectory(input.roomId);
    await fs.mkdir(roomDirectory, { recursive: true });

    const extension = this.resolveFileExtension(
      input.mimeType,
      input.originalName,
    );
    const fileName = `${Date.now()}-${input.playerId.slice(0, 8)}-${crypto
      .randomUUID()
      .slice(0, 8)}${extension}`;
    const filePath = path.join(roomDirectory, fileName);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(tempPath, 'w');
      await handle.writeFile(input.fileBuffer);
      await handle.sync();
    } finally {
      if (handle) {
        await handle.close();
      }
    }

    await fs.rename(tempPath, filePath);

    return {
      audioUrl: `/uploads/chat-audio/${encodeURIComponent(input.roomId)}/${encodeURIComponent(fileName)}`,
      sizeBytes: input.fileBuffer.byteLength,
      mimeType: input.mimeType,
    };
  }

  async deleteRoomMedia(roomId: string): Promise<void> {
    const roomDirectory = this.getRoomDirectory(roomId);
    await fs.rm(roomDirectory, { recursive: true, force: true });
  }

  async pruneOrphanMedia(
    roomId: string,
    keepAudioUrls: string[],
  ): Promise<PruneOrphanMediaResult> {
    const roomDirectory = this.getRoomDirectory(roomId);

    let fileNames: string[];
    try {
      fileNames = await fs.readdir(roomDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { deleted: 0 };
      }
      throw error;
    }

    const keepFileNames = new Set(
      keepAudioUrls
        .map((audioUrl) => this.extractFileNameFromAudioUrl(roomId, audioUrl))
        .filter((fileName): fileName is string => Boolean(fileName)),
    );

    let deleted = 0;
    for (const fileName of fileNames) {
      if (keepFileNames.has(fileName)) {
        continue;
      }

      await fs.rm(path.join(roomDirectory, fileName), { force: true });
      deleted += 1;
    }

    return { deleted };
  }

  private getRoomDirectory(roomId: string): string {
    return path.join(this.chatAudioDir, roomId);
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.chatAudioDir, { recursive: true });
  }

  private resolveFileExtension(mimeType: string, originalName?: string): string {
    const normalized = mimeType.toLowerCase().trim();
    if (normalized === 'audio/webm') {
      return '.webm';
    }
    if (normalized === 'audio/ogg') {
      return '.ogg';
    }
    if (normalized === 'audio/mp4') {
      return '.m4a';
    }
    if (normalized === 'audio/mpeg') {
      return '.mp3';
    }
    if (normalized === 'audio/wav' || normalized === 'audio/x-wav') {
      return '.wav';
    }

    if (originalName) {
      const extension = path.extname(originalName).trim();
      if (extension) {
        return extension;
      }
    }

    return '.webm';
  }

  private extractFileNameFromAudioUrl(
    roomId: string,
    audioUrl: string,
  ): string | null {
    const expectedPrefix = `/uploads/chat-audio/${encodeURIComponent(roomId)}/`;
    if (!audioUrl.startsWith(expectedPrefix)) {
      return null;
    }

    const encodedName = audioUrl.slice(expectedPrefix.length);
    if (!encodedName) {
      return null;
    }

    return decodeURIComponent(encodedName);
  }
}
