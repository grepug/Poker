import { Room } from 'poker-types';

/**
 * Abstract storage interface for room persistence
 * Allows swapping implementations (JSON, Database, etc.) without changing game logic
 */
export interface IStorageService {
  /**
   * Save a room to storage
   */
  saveRoom(room: Room): Promise<void>;

  /**
   * Retrieve a room by ID
   * Returns null if room doesn't exist
   */
  getRoom(roomId: string): Promise<Room | null>;

  /**
   * Delete a room from storage
   */
  deleteRoom(roomId: string): Promise<void>;

  /**
   * Get all rooms
   */
  getAllRooms(): Promise<Room[]>;

  /**
   * Check if a room exists
   */
  roomExists(roomId: string): Promise<boolean>;
}
