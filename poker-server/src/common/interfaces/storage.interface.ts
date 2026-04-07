import { Room, RoomPersistedWrite } from 'poker-types';

/**
 * Room persistence boundary used by game/auth/chat flows.
 * Implementations may be file-backed or database-backed as long as they
 * preserve the same room projection and canonical room-event write contract.
 */
export interface IStorageService {
  /**
   * Persist the canonical room/game history plus the latest bounded snapshot.
   */
  persistRoom(room: Room, write?: RoomPersistedWrite): Promise<void>;

  /**
   * Retrieve the latest room projection by ID.
   */
  getRoom(roomId: string): Promise<Room | null>;

  /**
   * Delete a room and its persisted history.
   */
  deleteRoom(roomId: string): Promise<void>;

  /**
   * Get the latest bounded room projections.
   */
  getAllRooms(): Promise<Room[]>;

  /**
   * Check if a room exists in persisted storage.
   */
  roomExists(roomId: string): Promise<boolean>;
}
