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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
