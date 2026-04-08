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
  ],
  controllers: [AppController, HandHistoryController],
  providers: [AppService],
})
export class AppModule {}
