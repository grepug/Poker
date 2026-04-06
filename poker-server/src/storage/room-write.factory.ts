import {
  BettingRound,
  PersistedActor,
  PersistedRoomEventRecord,
  RoomPersistedWrite,
} from 'poker-types';

export function roomEvent(params: {
  roomId: string;
  type: PersistedRoomEventRecord['type'];
  payload: Record<string, unknown>;
  actor?: PersistedActor;
  handNumber?: number | null;
  street?: BettingRound | null;
}): Omit<PersistedRoomEventRecord, 'recordId' | 'seq' | 'timestamp'> {
  return {
    roomId: params.roomId,
    type: params.type,
    payload: params.payload,
    actor: params.actor,
    handNumber: params.handNumber ?? null,
    street: params.street ?? null,
  };
}

export function roomWrite(
  ...events: Array<Omit<PersistedRoomEventRecord, 'recordId' | 'seq' | 'timestamp'>>
): RoomPersistedWrite {
  return { events };
}
