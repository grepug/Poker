import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AuthSessionRecord,
  AuthUserRecord,
  IAuthStorageService,
} from '../common/interfaces/auth-storage.interface';

@Injectable()
export class JsonAuthStorageService implements IAuthStorageService {
  private readonly logger = new Logger(JsonAuthStorageService.name);
  private readonly authDir: string;
  private readonly usersFilePath: string;
  private readonly sessionsFilePath: string;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.authDir = path.join(dataDir, 'auth');
    this.usersFilePath = path.join(this.authDir, 'users.json');
    this.sessionsFilePath = path.join(this.authDir, 'sessions.json');
    this.ensureFiles().catch((error) => {
      this.logger.error(`Failed to initialize auth storage: ${error.message}`);
    });
  }

  private async ensureFiles(): Promise<void> {
    await fs.mkdir(this.authDir, { recursive: true });
    await this.ensureArrayFile(this.usersFilePath);
    await this.ensureArrayFile(this.sessionsFilePath);
  }

  private async ensureArrayFile(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, '[]', 'utf-8');
    }
  }

  private async readArrayFile<T>(filePath: string): Promise<T[]> {
    await this.ensureFiles();
    const raw = await fs.readFile(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as T[];
    } catch {
      this.logger.warn(`Invalid JSON in ${filePath}; using empty list`);
      return [];
    }
  }

  private async writeArrayFile<T>(filePath: string, data: T[]): Promise<void> {
    await this.enqueueWrite(filePath, async () => {
      await this.ensureFiles();
      const serialized = JSON.stringify(data, null, 2);
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      await fs.writeFile(tempPath, serialized, 'utf-8');
      await fs.rename(tempPath, filePath);
    });
  }

  private async enqueueWrite(
    filePath: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.writeQueues.set(filePath, next);

    try {
      await next;
    } finally {
      if (this.writeQueues.get(filePath) === next) {
        this.writeQueues.delete(filePath);
      }
    }
  }

  async getUsers(): Promise<AuthUserRecord[]> {
    return this.readArrayFile<AuthUserRecord>(this.usersFilePath);
  }

  async saveUsers(users: AuthUserRecord[]): Promise<void> {
    await this.writeArrayFile(this.usersFilePath, users);
  }

  async getSessions(): Promise<AuthSessionRecord[]> {
    return this.readArrayFile<AuthSessionRecord>(this.sessionsFilePath);
  }

  async saveSessions(sessions: AuthSessionRecord[]): Promise<void> {
    await this.writeArrayFile(this.sessionsFilePath, sessions);
  }
}
