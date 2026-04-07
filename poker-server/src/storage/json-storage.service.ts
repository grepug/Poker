import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PersistedRoomEventRecord,
  PersistedRoomSnapshot,
  Room,
  RoomPersistedWrite,
} from 'poker-types';
import { randomUUID } from 'crypto';
import { IStorageService } from '../common/interfaces/storage.interface';
import {
  appendJsonlRecords,
  ensureDir,
  pathExists,
  readJsonFile,
  readJsonlRecords,
  writeJsonFileAtomic,
} from './jsonl-store.util';
import * as fs from 'fs/promises';
import * as path from 'path';

type StoredRoomProjection = {
  snapshot: PersistedRoomSnapshot;
  room: Room;
};

@Injectable()
export class JsonStorageService implements IStorageService {
  private readonly logger = new Logger(JsonStorageService.name);
  private readonly dataDir: string;
  private readonly roomsDir: string;
  private readonly roomWriteQueues: Map<string, Promise<void>> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.roomsDir = path.join(this.dataDir, 'rooms');
    this.ensureDirectories().catch((err) =>
      this.logger.error(`Failed to initialize directories: ${err.message}`),
    );
  }

  async persistRoom(room: Room, write?: RoomPersistedWrite): Promise<void> {
    return this.runRoomWriteSequentially(room.id, async () => {
      try {
        await this.ensureDirectories();
        await this.migrateLegacyRoomIfNeeded(room.id);

        const currentProjection = await this.loadProjection(room.id);
        let nextSeq = currentProjection?.snapshot.lastRoomEventSeq ?? 0;
        const timestamp = Number(room.lastActivityAt || Date.now());
        const providedEvents = write?.events ?? [];

        const roomEvents: PersistedRoomEventRecord[] = providedEvents.map((event) => ({
          ...event,
          recordId: randomUUID(),
          seq: ++nextSeq,
          timestamp,
        }));

        const snapshotEvent: PersistedRoomEventRecord = {
          recordId: randomUUID(),
          seq: ++nextSeq,
          roomId: room.id,
          handNumber: room.currentHand?.handNumber ?? null,
          street: room.currentHand?.bettingRound ?? null,
          timestamp,
          type: 'ROOM_STATE_UPDATED',
          actor: { source: 'SYSTEM' },
          payload: {
            room,
          },
        };
        roomEvents.push(snapshotEvent);

        await appendJsonlRecords(this.getRoomEventsPath(room.id), roomEvents);
        await this.appendHandEvents(room.id, roomEvents);
        await this.writeProjection(room.id, {
          snapshot: {
            lastRoomEventSeq: nextSeq,
            updatedAt: timestamp,
          },
          room,
        });
        this.logger.debug(`Room ${room.id} persisted via JSONL storage`);
      } catch (error) {
        this.logger.error(
          `Failed to persist room ${room.id}: ${(error as Error).message}`,
        );
        throw new Error(`Failed to persist room: ${(error as Error).message}`);
      }
    });
  }

  async getRoom(roomId: string): Promise<Room | null> {
    try {
      await this.ensureDirectories();
      await this.migrateLegacyRoomIfNeeded(roomId);

      const projection = await this.loadProjection(roomId);
      if (projection?.room) {
        return projection.room;
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve room ${roomId}: ${(error as Error).message}`,
      );
      throw new Error(`Failed to retrieve room: ${(error as Error).message}`);
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    try {
      await fs.rm(this.getRoomDir(roomId), { recursive: true, force: true });
      await fs.rm(this.getLegacyRoomFilePath(roomId), { force: true });
      this.logger.log(`Room ${roomId} deleted from JSONL storage`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      this.logger.error(
        `Failed to delete room ${roomId}: ${(error as Error).message}`,
      );
      throw new Error(`Failed to delete room: ${(error as Error).message}`);
    }
  }

  async getAllRooms(): Promise<Room[]> {
    try {
      await this.ensureDirectories();
      await this.migrateLegacyRoomsInDirectory();

      const entries = await fs.readdir(this.roomsDir, { withFileTypes: true });
      const rooms: Room[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        try {
          const room = await this.getRoom(entry.name);
          if (room) {
            rooms.push(room);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to parse room ${entry.name}: ${(error as Error).message}`,
          );
        }
      }

      return rooms;
    } catch (error) {
      this.logger.error(`Failed to get all rooms: ${(error as Error).message}`);
      throw new Error(`Failed to get all rooms: ${(error as Error).message}`);
    }
  }

  async roomExists(roomId: string): Promise<boolean> {
    return Boolean(await this.getRoom(roomId));
  }

  private async ensureDirectories(): Promise<void> {
    await ensureDir(this.roomsDir);
  }

  private getLegacyRoomFilePath(roomId: string): string {
    return path.join(this.roomsDir, `${roomId}.json`);
  }

  private getRoomDir(roomId: string): string {
    return path.join(this.roomsDir, roomId);
  }

  private getRoomEventsPath(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'room-events.jsonl');
  }

  private getHandsDir(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'hands');
  }

  private getHandEventsPath(roomId: string, handNumber: number): string {
    return path.join(this.getHandsDir(roomId), `${handNumber}.jsonl`);
  }

  private getProjectionPath(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'room.snapshot.json');
  }

  private async readProjection(roomId: string): Promise<StoredRoomProjection | null> {
    return await readJsonFile<StoredRoomProjection>(this.getProjectionPath(roomId));
  }

  private async loadProjection(
    roomId: string,
  ): Promise<StoredRoomProjection | null> {
    try {
      const projection = await this.readProjection(roomId);
      if (projection?.room) {
        return projection;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read room projection ${roomId}, rebuilding from log: ${(error as Error).message}`,
      );
    }

    return await this.rebuildProjectionFromLog(roomId);
  }

  private async writeProjection(
    roomId: string,
    projection: StoredRoomProjection,
  ): Promise<void> {
    await writeJsonFileAtomic(this.getProjectionPath(roomId), projection);
  }

  private async appendHandEvents(
    roomId: string,
    roomEvents: PersistedRoomEventRecord[],
  ): Promise<void> {
    const eventsByHandNumber = new Map<number, PersistedRoomEventRecord[]>();

    for (const event of roomEvents) {
      if (!event.handNumber || event.type === 'ROOM_STATE_UPDATED') {
        continue;
      }

      const records = eventsByHandNumber.get(event.handNumber) ?? [];
      records.push(event);
      eventsByHandNumber.set(event.handNumber, records);
    }

    await Promise.all(
      Array.from(eventsByHandNumber.entries()).map(([handNumber, records]) =>
        appendJsonlRecords(this.getHandEventsPath(roomId, handNumber), records),
      ),
    );
  }

  private async rebuildProjectionFromLog(
    roomId: string,
  ): Promise<StoredRoomProjection | null> {
    const events = await readJsonlRecords<PersistedRoomEventRecord>(
      this.getRoomEventsPath(roomId),
    );
    if (events.length === 0) {
      return null;
    }

    const latestSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'ROOM_STATE_UPDATED');
    const room = latestSnapshot?.payload.room as Room | undefined;
    if (!room) {
      return null;
    }

    const projection: StoredRoomProjection = {
      snapshot: {
        lastRoomEventSeq: events[events.length - 1].seq,
        updatedAt: latestSnapshot.timestamp,
      },
      room,
    };
    await this.writeProjection(roomId, projection);
    return projection;
  }

  private async runRoomWriteSequentially<T>(
    roomId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousQueue = this.roomWriteQueues.get(roomId) || Promise.resolve();
    let releaseCurrent: () => void = () => {};

    const gate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const nextQueue = previousQueue.finally(() => gate);
    this.roomWriteQueues.set(roomId, nextQueue);

    await previousQueue.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.roomWriteQueues.get(roomId) === nextQueue) {
        this.roomWriteQueues.delete(roomId);
      }
    }
  }

  private async migrateLegacyRoomsInDirectory(): Promise<void> {
    const entries = await fs.readdir(this.roomsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      await this.migrateLegacyRoomIfNeeded(entry.name.replace(/\.json$/, ''));
    }
  }

  private async migrateLegacyRoomIfNeeded(roomId: string): Promise<void> {
    const legacyPath = this.getLegacyRoomFilePath(roomId);
    const hasLegacy = await pathExists(legacyPath);
    const hasProjection = await pathExists(this.getProjectionPath(roomId));
    const hasLog = await pathExists(this.getRoomEventsPath(roomId));
    if (!hasLegacy) {
      return;
    }

    if (hasProjection || hasLog) {
      const cleanedUp = await this.cleanupLegacyRoomIfJsonlReady(
        roomId,
        legacyPath,
        hasProjection,
        hasLog,
      );
      if (!cleanedUp) {
        this.logger.warn(
          `Skipping legacy room migration for ${roomId} because the JSONL layout is only partially present`,
        );
      }
      return;
    }

    const legacyRoom = await readJsonFile<Room>(legacyPath);
    if (!legacyRoom) {
      return;
    }

    const migratedAt = Number(
      legacyRoom.lastActivityAt || legacyRoom.createdAt || Date.now(),
    );
    const migrationEvents: PersistedRoomEventRecord[] = [
      {
        recordId: randomUUID(),
        seq: 1,
        roomId,
        handNumber: legacyRoom.currentHand?.handNumber ?? null,
        street: legacyRoom.currentHand?.bettingRound ?? null,
        timestamp: migratedAt,
        type: 'ROOM_MIGRATED',
        actor: { source: 'MIGRATION' },
        payload: {
          legacyPath,
        },
      },
      {
        recordId: randomUUID(),
        seq: 2,
        roomId,
        handNumber: legacyRoom.currentHand?.handNumber ?? null,
        street: legacyRoom.currentHand?.bettingRound ?? null,
        timestamp: migratedAt,
        type: 'ROOM_STATE_UPDATED',
        actor: { source: 'MIGRATION' },
        payload: {
          room: legacyRoom,
        },
      },
    ];

    await appendJsonlRecords(this.getRoomEventsPath(roomId), migrationEvents);
    await this.appendHandEvents(roomId, migrationEvents);
    await this.writeProjection(roomId, {
      snapshot: {
        lastRoomEventSeq: 2,
        updatedAt: migratedAt,
      },
      room: legacyRoom,
    });
    await fs.rm(legacyPath, { force: true });
    this.logger.log(`Migrated legacy room snapshot ${roomId} to JSONL layout`);
  }

  private async cleanupLegacyRoomIfJsonlReady(
    roomId: string,
    legacyPath: string,
    hasProjection: boolean,
    hasLog: boolean,
  ): Promise<boolean> {
    if (!hasLog) {
      return false;
    }

    await readJsonlRecords<PersistedRoomEventRecord>(this.getRoomEventsPath(roomId));
    if (hasProjection) {
      try {
        await readJsonFile<StoredRoomProjection>(this.getProjectionPath(roomId));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Projection for room ${roomId} is unreadable during legacy cleanup; rebuilding from room log: ${message}`,
        );
        await this.rebuildProjectionFromLog(roomId);
      }
    } else {
      await this.rebuildProjectionFromLog(roomId);
    }

    await fs.rm(legacyPath, { force: true });
    this.logger.log(`Removed legacy room snapshot ${roomId} after confirming JSONL layout`);
    return true;
  }
}
