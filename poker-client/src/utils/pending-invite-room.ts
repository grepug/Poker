type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PendingInviteRoomRecord = {
  roomId: string;
  savedAt: number;
};

const PENDING_INVITE_ROOM_STORAGE_KEY = "poker.pendingInviteRoom";
const PENDING_INVITE_ROOM_TTL_MS = 30 * 60 * 1000;
const ROOM_ID_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export const normalizePendingInviteRoomId = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return ROOM_ID_PATTERN.test(normalized) ? normalized : null;
};

export const buildPendingInviteAuthPath = (roomId: string): string => {
  const normalized = normalizePendingInviteRoomId(roomId);
  return normalized ? `/auth?roomId=${encodeURIComponent(normalized)}` : "/auth";
};

export const readPendingInviteRoomIdFromSearch = (
  search: string,
): string | null => {
  const params = new URLSearchParams(search);
  return normalizePendingInviteRoomId(params.get("roomId"));
};

export const clearPendingInviteRoom = (storage: StorageLike | null): void => {
  storage?.removeItem(PENDING_INVITE_ROOM_STORAGE_KEY);
};

export const writePendingInviteRoom = (
  roomId: string,
  storage: StorageLike | null,
  now: number = Date.now(),
): string | null => {
  const normalized = normalizePendingInviteRoomId(roomId);
  if (!storage || !normalized) {
    clearPendingInviteRoom(storage);
    return null;
  }

  const record: PendingInviteRoomRecord = {
    roomId: normalized,
    savedAt: now,
  };
  storage.setItem(PENDING_INVITE_ROOM_STORAGE_KEY, JSON.stringify(record));
  return normalized;
};

const readPendingInviteRoomRecord = (
  storage: StorageLike | null,
): PendingInviteRoomRecord | null => {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(PENDING_INVITE_ROOM_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PendingInviteRoomRecord;
  } catch {
    return null;
  }
};

export const readPendingInviteRoom = (
  storage: StorageLike | null,
  now: number = Date.now(),
): string | null => {
  const record = readPendingInviteRoomRecord(storage);
  const normalizedRoomId = normalizePendingInviteRoomId(record?.roomId);

  if (
    !storage ||
    !record ||
    !normalizedRoomId ||
    typeof record.savedAt !== "number" ||
    !Number.isFinite(record.savedAt) ||
    record.savedAt <= 0 ||
    now - record.savedAt > PENDING_INVITE_ROOM_TTL_MS
  ) {
    clearPendingInviteRoom(storage);
    return null;
  }

  return normalizedRoomId;
};

export const syncPendingInviteRoomFromSearch = (
  search: string,
  storage: StorageLike | null,
  now: number = Date.now(),
): string | null => {
  const params = new URLSearchParams(search);
  if (!params.has("roomId")) {
    return null;
  }

  const normalized = normalizePendingInviteRoomId(params.get("roomId"));
  if (!normalized) {
    clearPendingInviteRoom(storage);
    return null;
  }

  writePendingInviteRoom(normalized, storage, now);
  return normalized;
};

export const consumePendingInviteRoom = (
  search: string,
  storage: StorageLike | null,
): string | null => {
  const roomId = readPendingInviteRoomIdFromSearch(search);
  clearPendingInviteRoom(storage);
  return roomId;
};
