import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import type { IStorageService } from '../common/interfaces/storage.interface';

type SessionUser = {
  id: string;
  displayName: string;
  avatarEmoji: string;
};

type RoomPlayerWithUser = {
  id: string;
  name: string;
  emoji?: string;
  status: string;
  userId?: string;
};

export type LiveAudioPublicConfig = {
  enabled: boolean;
  serverUrl?: string;
};

export type LiveAudioJoinPayload = LiveAudioPublicConfig & {
  token: string;
  roomName: string;
  participantIdentity: string;
  participantName: string;
  participantMetadata: string;
};

@Injectable()
export class LiveAudioService {
  private readonly serverUrl = process.env.LIVEKIT_URL?.trim() || '';
  private readonly apiKey = process.env.LIVEKIT_API_KEY?.trim() || '';
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || '';
  private readonly featureFlag = process.env.LIVE_AUDIO_ENABLED?.trim();
  private readonly tokenTtl = process.env.LIVE_AUDIO_TOKEN_TTL?.trim() || '10m';

  constructor(
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  getPublicConfig(): LiveAudioPublicConfig {
    if (!this.isEnabled()) {
      return {
        enabled: false,
      };
    }

    return {
      enabled: true,
      serverUrl: this.serverUrl,
    };
  }

  async createJoinToken(input: {
    roomId: string;
    user: SessionUser | null;
  }): Promise<LiveAudioJoinPayload> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Live audio is disabled');
    }

    const roomId = input.roomId?.trim().toUpperCase();
    if (!roomId) {
      throw new BadRequestException('roomId is required');
    }

    if (!input.user) {
      throw new UnauthorizedException('Invalid session');
    }

    const room = await this.storageService.getRoom(roomId);
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const roomPlayer = (room.players as RoomPlayerWithUser[]).find(
      (player) => player.userId === input.user?.id && player.status !== 'left',
    );
    if (!roomPlayer) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const roomName = this.toLiveKitRoomName(room.id);
    const participantIdentity = `${input.user.id}:${roomPlayer.id}`;
    const participantMetadata = JSON.stringify({
      roomId: room.id,
      playerId: roomPlayer.id,
      userId: input.user.id,
      displayName: input.user.displayName,
      avatarEmoji: input.user.avatarEmoji,
    });

    const accessToken = new AccessToken(this.apiKey, this.apiSecret, {
      ttl: this.tokenTtl,
      identity: participantIdentity,
      name: input.user.displayName,
      metadata: participantMetadata,
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: false,
    });

    return {
      enabled: true,
      serverUrl: this.serverUrl,
      roomName,
      participantIdentity,
      participantName: input.user.displayName,
      participantMetadata,
      token: await accessToken.toJwt(),
    };
  }

  private isEnabled(): boolean {
    if (this.featureFlag === 'false') {
      return false;
    }

    return Boolean(this.serverUrl && this.apiKey && this.apiSecret);
  }

  private toLiveKitRoomName(roomId: string): string {
    return `poker-room-${roomId.trim().toUpperCase()}`;
  }
}
