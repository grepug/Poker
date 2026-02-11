import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IStorageService } from './common/interfaces/storage.interface';

describe('AppController', () => {
  let appController: AppController;
  let storageService: jest.Mocked<IStorageService>;

  beforeEach(async () => {
    storageService = {
      saveRoom: jest.fn(),
      getRoom: jest.fn(),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn().mockResolvedValue([]),
      roomExists: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: 'IStorageService',
          useValue: storageService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return healthy status when storage is reachable', async () => {
      storageService.getAllRooms.mockResolvedValueOnce([]);

      const response = await appController.getHealth();

      expect(response.status).toBe('ok');
      expect(response.checks.storage.status).toBe('ok');
      expect(response.checks.storage.roomCount).toBe(0);
      expect(response.timestamp).toEqual(expect.any(String));
      expect(response.uptime).toEqual(expect.any(Number));
    });

    it('should throw ServiceUnavailableException when storage check fails', async () => {
      storageService.getAllRooms.mockRejectedValueOnce(
        new Error('disk unavailable'),
      );

      let thrownError: ServiceUnavailableException | null = null;

      try {
        await appController.getHealth();
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          thrownError = error;
        }
      }

      expect(thrownError).toBeInstanceOf(ServiceUnavailableException);
      const response = thrownError?.getResponse() as Record<string, any>;

      expect(response).toMatchObject({
        status: 'error',
        checks: {
          storage: {
            status: 'error',
            error: 'disk unavailable',
          },
        },
      });
    });
  });
});
