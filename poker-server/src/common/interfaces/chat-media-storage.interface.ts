export interface SaveVoiceClipInput {
  roomId: string;
  playerId: string;
  fileBuffer: Buffer;
  mimeType: string;
  originalName?: string;
}

export interface SaveVoiceClipResult {
  audioUrl: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PruneOrphanMediaResult {
  deleted: number;
}

export interface IChatMediaStorageService {
  saveVoiceClip(input: SaveVoiceClipInput): Promise<SaveVoiceClipResult>;
  deleteRoomMedia(roomId: string): Promise<void>;
  pruneOrphanMedia(
    roomId: string,
    keepAudioUrls: string[],
  ): Promise<PruneOrphanMediaResult>;
}
