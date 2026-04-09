import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { HandService } from './hand.service';
import { BettingService } from './betting.service';
import { TestDeckService } from './test-deck.service';
import { RobotAgentService } from './robot-agent.service';
import { SavedGameReviewService } from './saved-game-review.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [
    GameService,
    HandService,
    BettingService,
    TestDeckService,
    RobotAgentService,
    SavedGameReviewService,
  ],
  exports: [
    GameService,
    HandService,
    BettingService,
    TestDeckService,
    RobotAgentService,
    SavedGameReviewService,
  ],
})
export class GameModule {}
