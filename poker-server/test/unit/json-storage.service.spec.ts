import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JsonStorageService } from '../../src/storage/json-storage.service';
import { Room, GameStateType } from 'poker-types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { roomEvent, roomWrite } from '../../src/storage/room-write.factory';

describe('JsonStorageService', () => {
  let service: JsonStorageService;
  const testDataDir = path.join(__dirname, '..', '..', 'test-data');
  const testRoomsDir = path.join(testDataDir, 'rooms');

  beforeEach(async () => {
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }
    await fs.mkdir(testRoomsDir, { recursive: true });

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ DATA_DIR: testDataDir })],
        }),
      ],
      providers: [JsonStorageService],
    }).compile();

    service = module.get<JsonStorageService>(JsonStorageService);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore
    }
  });

  const createMockRoom = (id: string): Room => ({
    id,
    hostId: 'player1',
    config: {
      startingChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      maxPlayers: 6,
      reconnectGracePeriod: 30000,
      allowPlayerStreetReveal: true,
    },
    players: [],
    gameState: 'WAITING' as GameStateType,
    currentHand: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });

  describe('persistRoom', () => {
    it('should save room to room snapshot file', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const filePath = path.join(testRoomsDir, 'TEST123', 'room.snapshot.json');
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should save correct data', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const filePath = path.join(testRoomsDir, 'TEST123', 'room.snapshot.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(data);

      expect(saved.room.id).toBe('TEST123');
      expect(saved.room.hostId).toBe('player1');
      expect(saved.room.config.startingChips).toBe(1000);
      expect(saved.snapshot.lastRoomEventSeq).toBeGreaterThan(0);
    });

    it('should overwrite existing room', async () => {
      const room1 = createMockRoom('TEST123');
      room1.config.startingChips = 1000;

      const room2 = createMockRoom('TEST123');
      room2.config.startingChips = 2000;

      await service.persistRoom(room1);
      await service.persistRoom(room2);

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved?.config.startingChips).toBe(2000);
    });

    it('serializes concurrent writes per room with monotonic event sequences', async () => {
      await Promise.all(
        Array.from({ length: 8 }).map((_, index) =>
          service.persistRoom({
            ...createMockRoom('ROOMSEQ'),
            config: {
              ...createMockRoom('ROOMSEQ').config,
              startingChips: 1000 + index,
            },
            lastActivityAt: index + 1,
          }),
        ),
      );

      const raw = await fs.readFile(
        path.join(testRoomsDir, 'ROOMSEQ', 'room-events.jsonl'),
        'utf-8',
      );
      const seqs = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).seq);

      expect(seqs).toEqual(Array.from({ length: 8 }, (_, index) => index + 1));
    });

    it('rebuilds from the room log when the snapshot file is missing before the next write', async () => {
      const original = createMockRoom('ROOMLOG');
      original.config.startingChips = 1000;
      original.lastActivityAt = 100;

      await service.persistRoom(
        original,
        roomWrite(
          roomEvent({
            roomId: original.id,
            type: 'ROOM_CONFIG_UPDATED',
            actor: { source: 'ROOM_SERVICE' },
            payload: {
              startingChips: original.config.startingChips,
            },
          }),
        ),
      );

      await fs.rm(path.join(testRoomsDir, 'ROOMLOG', 'room.snapshot.json'));

      const updated = {
        ...original,
        config: {
          ...original.config,
          startingChips: 2000,
        },
        lastActivityAt: 200,
      };

      await service.persistRoom(
        updated,
        roomWrite(
          roomEvent({
            roomId: updated.id,
            type: 'ROOM_CONFIG_UPDATED',
            actor: { source: 'ROOM_SERVICE' },
            payload: {
              startingChips: updated.config.startingChips,
            },
          }),
        ),
      );

      const raw = await fs.readFile(
        path.join(testRoomsDir, 'ROOMLOG', 'room-events.jsonl'),
        'utf-8',
      );
      const records = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(records.map((record) => record.seq)).toEqual([1, 2, 3, 4]);
      expect(records[2].type).toBe('ROOM_CONFIG_UPDATED');
      expect((await service.getRoom('ROOMLOG'))?.config.startingChips).toBe(2000);
    });
  });

  describe('getRoom', () => {
    it('should retrieve saved room', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('TEST123');
    });

    it('should return null for non-existent room', async () => {
      const retrieved = await service.getRoom('NONEXISTENT');
      expect(retrieved).toBeNull();
    });

    it('should parse room data correctly', async () => {
      const room = createMockRoom('TEST123');
      room.players = [
        {
          id: 'p1',
          socketId: 's1',
          name: 'Alice',
          chips: 1000,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'waiting',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
        },
      ];

      await service.persistRoom(room);
      const retrieved = await service.getRoom('TEST123');

      expect(retrieved?.players).toHaveLength(1);
      expect(retrieved?.players[0].name).toBe('Alice');
    });
  });

  describe('deleteRoom', () => {
    it('should delete existing room', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      await service.deleteRoom('TEST123');

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved).toBeNull();
    });

    it('should not throw error for non-existent room', async () => {
      await expect(service.deleteRoom('NONEXISTENT')).resolves.not.toThrow();
    });
  });

  describe('getAllRooms', () => {
    it('should return empty array when no rooms', async () => {
      const rooms = await service.getAllRooms();
      expect(rooms).toEqual([]);
    });

    it('should return all saved rooms', async () => {
      const room1 = createMockRoom('ROOM1');
      const room2 = createMockRoom('ROOM2');
      const room3 = createMockRoom('ROOM3');

      await service.persistRoom(room1);
      await service.persistRoom(room2);
      await service.persistRoom(room3);

      const rooms = await service.getAllRooms();
      expect(rooms).toHaveLength(3);

      const ids = rooms.map((r) => r.id).sort();
      expect(ids).toEqual(['ROOM1', 'ROOM2', 'ROOM3']);
    });

    it('should skip corrupted files', async () => {
      const room = createMockRoom('ROOM1');
      await service.persistRoom(room);

      // Create a corrupted file
      const corruptedDir = path.join(testRoomsDir, 'CORRUPTED');
      await fs.mkdir(corruptedDir, { recursive: true });
      const corruptedPath = path.join(corruptedDir, 'room.snapshot.json');
      await fs.writeFile(corruptedPath, 'invalid json {{{', 'utf-8');

      const rooms = await service.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('ROOM1');
    });
  });

  describe('roomExists', () => {
    it('should return true for existing room', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const exists = await service.roomExists('TEST123');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent room', async () => {
      const exists = await service.roomExists('NONEXISTENT');
      expect(exists).toBe(false);
    });
  });
});
