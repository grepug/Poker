import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { HandService } from './hand.service';
import { BettingService } from './betting.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [GameService, HandService, BettingService],
  exports: [GameService, HandService, BettingService],
})
export class GameModule {}
