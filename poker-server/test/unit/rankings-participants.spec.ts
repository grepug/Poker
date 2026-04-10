import {
  shouldIncludeArchivedRankingParticipant,
  shouldIncludeLiveRankingPlayer,
} from 'poker-types';

describe('ranking participant filters', () => {
  it('excludes robots that never bought in or played from live rankings', () => {
    expect(
      shouldIncludeLiveRankingPlayer({
        isRobot: true,
        status: 'left',
        chips: 0,
        currentBet: 0,
        totalBuyIn: 0,
        handsPlayedCount: 0,
        handsWonCount: 0,
        vpipHandsCount: 0,
      }),
    ).toBe(false);
  });

  it('keeps robots that actually participated in the game', () => {
    expect(
      shouldIncludeLiveRankingPlayer({
        isRobot: true,
        status: 'left',
        chips: 0,
        currentBet: 0,
        totalBuyIn: 1000,
        handsPlayedCount: 1,
        handsWonCount: 0,
        vpipHandsCount: 1,
      }),
    ).toBe(true);
  });

  it('excludes zero-activity robots from archived standings as well', () => {
    expect(
      shouldIncludeArchivedRankingParticipant({
        isRobot: true,
        finalChips: 0,
        totalBuyIn: 0,
        handsPlayedCount: 0,
        handsWonCount: 0,
        vpipHandsCount: 0,
      }),
    ).toBe(false);
  });
});
