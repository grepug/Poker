import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JsonStorageService } from '../../src/storage/json-storage.service';
import { Room, GameStateType } from 'poker-types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('JsonStorageService', () => {
  let service: JsonStorageService;
  const testDataDir = path.join(__dirname, '..', '..', 'test-data');
  const testRoomsDir = path.join(testDataDir, 'rooms');

  beforeEach(async () => {
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

    // Clean test directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }
    await fs.mkdir(testRoomsDir, { recursive: true });
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

  describe('saveRoom', () => {
    it('should save room to JSON file', async () => {
      const room = createMockRoom('TEST123');
      await service.saveRoom(room);

      const filePath = path.join(testRoomsDir, 'TEST123.json');
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should save correct data', async () => {
      const room = createMockRoom('TEST123');
      await service.saveRoom(room);

      const filePath = path.join(testRoomsDir, 'TEST123.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(data);

      expect(saved.id).toBe('TEST123');
      expect(saved.hostId).toBe('player1');
      expect(saved.config.startingChips).toBe(1000);
    });

    it('should overwrite existing room', async () => {
      const room1 = createMockRoom('TEST123');
      room1.config.startingChips = 1000;

      const room2 = createMockRoom('TEST123');
      room2.config.startingChips = 2000;

      await service.saveRoom(room1);
      await service.saveRoom(room2);

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved?.config.startingChips).toBe(2000);
    });
  });

  describe('getRoom', () => {
    it('should retrieve saved room', async () => {
      const room = createMockRoom('TEST123');
      await service.saveRoom(room);

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
          position: 0,
          status: 'waiting',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
        },
      ];

      await service.saveRoom(room);
      const retrieved = await service.getRoom('TEST123');

      expect(retrieved?.players).toHaveLength(1);
      expect(retrieved?.players[0].name).toBe('Alice');
    });
  });

  describe('deleteRoom', () => {
    it('should delete existing room', async () => {
      const room = createMockRoom('TEST123');
      await service.saveRoom(room);

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

      await service.saveRoom(room1);
      await service.saveRoom(room2);
      await service.saveRoom(room3);

      const rooms = await service.getAllRooms();
      expect(rooms).toHaveLength(3);

      const ids = rooms.map((r) => r.id).sort();
      expect(ids).toEqual(['ROOM1', 'ROOM2', 'ROOM3']);
    });

    it('should skip corrupted files', async () => {
      const room = createMockRoom('ROOM1');
      await service.saveRoom(room);

      // Create a corrupted file
      const corruptedPath = path.join(testRoomsDir, 'CORRUPTED.json');
      await fs.writeFile(corruptedPath, 'invalid json {{{', 'utf-8');

      const rooms = await service.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('ROOM1');
    });
  });

  describe('roomExists', () => {
    it('should return true for existing room', async () => {
      const room = createMockRoom('TEST123');
      await service.saveRoom(room);

      const exists = await service.roomExists('TEST123');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent room', async () => {
      const exists = await service.roomExists('NONEXISTENT');
      expect(exists).toBe(false);
    });
  });
});
