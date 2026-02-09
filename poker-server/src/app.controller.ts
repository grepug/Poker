import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppService } from './app.service';
import { IStorageService } from './common/interfaces/storage.interface';

type HealthResponse = {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  checks: {
    storage: {
      status: 'ok' | 'error';
      roomCount?: number;
      error?: string;
    };
  };
};

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(): Promise<HealthResponse> {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();

    try {
      const rooms = await this.storageService.getAllRooms();
      return {
        status: 'ok',
        timestamp,
        uptime,
        checks: {
          storage: {
            status: 'ok',
            roomCount: rooms.length,
          },
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown storage error';
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp,
        uptime,
        checks: {
          storage: {
            status: 'error',
            error: message,
          },
        },
      } as HealthResponse);
    }
  }
}
