import type {
  Room,
  PersistedRoomSnapshot,
  SavedGameHandDetail,
} from 'poker-types';

export type StoredRoomProjection = {
  snapshot: PersistedRoomSnapshot;
  room: Room;
};

export type ArchivedRoomPlayer = Room['players'][number] & {
  userId?: string;
  emoji?: string;
  isRobot?: boolean;
};

export type SavedGameArchiveRecord = {
  archiveId: string;
  roomId: string;
  createdAt: number;
  startedAt: number;
  concludedAt: number;
  handCount: number;
  blinds: {
    smallBlind: number;
    bigBlind: number;
  };
  participants: import('poker-types').SavedGameParticipant[];
  playerViews: Record<
    string,
    {
      requesterUserId: string;
      requesterPlayerId: string;
      hands: SavedGameHandDetail[];
    }
  >;
};
