import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StorageModule } from './storage/storage.module';
import { GameModule } from './game/game.module';
import { EventsModule } from './events/events.module';
import { ChatModule } from './chat/chat.module';
import { AuthModule } from './auth/auth.module';
import { HandHistoryController } from './hand-history.controller';
import { SavedGameHistoryController } from './saved-game-history.controller';
import { LiveAudioModule } from './live-audio/live-audio.module';
import { existsSync } from 'fs';
import * as path from 'path';

const runningInCi = process.env.CI === 'true';
const envFilePath = [
  path.resolve(__dirname, '..', '..', '.env'),
  path.resolve(__dirname, '..', '..', '..', '.env'),
].filter((candidate) => existsSync(candidate));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: runningInCi,
      envFilePath,
    }),
    StorageModule,
    GameModule,
    EventsModule,
    ChatModule,
    AuthModule,
    LiveAudioModule,
  ],
  controllers: [
    AppController,
    HandHistoryController,
    SavedGameHistoryController,
  ],
  providers: [AppService],
})
export class AppModule {}
