import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Room } from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class JsonStorageService implements IStorageService {
  private readonly logger = new Logger(JsonStorageService.name);
  private readonly dataDir: string;
  private readonly roomsDir: string;

  constructor(private configService: ConfigService) {
    this.dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.roomsDir = path.join(this.dataDir, 'rooms');
    // Don't await in constructor - directories will be created on first use
    this.ensureDirectories().catch((err) =>
      this.logger.error(`Failed to initialize directories: ${err.message}`),
    );
  }

  /**
   * Ensure data directories exist
   */
  private async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.roomsDir, { recursive: true });
      this.logger.log(`Data directories ensured at ${this.roomsDir}`);
    } catch (error) {
      this.logger.error(`Failed to create directories: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the file path for a room
   */
  private getRoomFilePath(roomId: string): string {
    return path.join(this.roomsDir, `${roomId}.json`);
  }

  async saveRoom(room: Room): Promise<void> {
    try {
      await this.ensureDirectories();
      const filePath = this.getRoomFilePath(room.id);
      const data = JSON.stringify(room, null, 2);
      await fs.writeFile(filePath, data, 'utf-8');
      this.logger.debug(`Room ${room.id} saved successfully`);
    } catch (error) {
      this.logger.error(`Failed to save room ${room.id}: ${error.message}`);
      throw new Error(`Failed to save room: ${error.message}`);
    }
  }

  async getRoom(roomId: string): Promise<Room | null> {
    try {
      const filePath = this.getRoomFilePath(roomId);
      const data = await fs.readFile(filePath, 'utf-8');
      const room = JSON.parse(data) as Room;
      this.logger.debug(`Room ${roomId} retrieved successfully`);
      return room;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug(`Room ${roomId} not found`);
        return null;
      }
      this.logger.error(`Failed to retrieve room ${roomId}: ${error.message}`);
      throw new Error(`Failed to retrieve room: ${error.message}`);
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    try {
      const filePath = this.getRoomFilePath(roomId);
      await fs.unlink(filePath);
      this.logger.log(`Room ${roomId} deleted successfully`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug(`Room ${roomId} already deleted or doesn't exist`);
        return;
      }
      this.logger.error(`Failed to delete room ${roomId}: ${error.message}`);
      throw new Error(`Failed to delete room: ${error.message}`);
    }
  }

  async getAllRooms(): Promise<Room[]> {
    try {
      const files = await fs.readdir(this.roomsDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      const rooms: Room[] = [];
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.roomsDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const room = JSON.parse(data) as Room;
          rooms.push(room);
        } catch (error) {
          this.logger.warn(
            `Failed to parse room file ${file}: ${error.message}`,
          );
        }
      }

      this.logger.debug(`Retrieved ${rooms.length} rooms`);
      return rooms;
    } catch (error) {
      this.logger.error(`Failed to get all rooms: ${error.message}`);
      throw new Error(`Failed to get all rooms: ${error.message}`);
    }
  }

  async roomExists(roomId: string): Promise<boolean> {
    try {
      const filePath = this.getRoomFilePath(roomId);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
