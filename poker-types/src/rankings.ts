type NumericValue = number | null | undefined;

type LiveRankingPlayerLike = {
  isRobot?: boolean;
  status?: string | null;
  chips?: NumericValue;
  currentBet?: NumericValue;
  totalBuyIn?: NumericValue;
  handsPlayedCount?: NumericValue;
  handsWonCount?: NumericValue;
  vpipHandsCount?: NumericValue;
};

type ArchivedRankingParticipantLike = {
  isRobot?: boolean;
  finalChips?: NumericValue;
  totalBuyIn?: NumericValue;
  handsPlayedCount?: NumericValue;
  handsWonCount?: NumericValue;
  vpipHandsCount?: NumericValue;
};

const toAmount = (value: NumericValue): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value;
};

const hasTrackedActivity = (snapshot: {
  totalBuyIn?: NumericValue;
  handsPlayedCount?: NumericValue;
  handsWonCount?: NumericValue;
  vpipHandsCount?: NumericValue;
}): boolean =>
  toAmount(snapshot.totalBuyIn) > 0 ||
  toAmount(snapshot.handsPlayedCount) > 0 ||
  toAmount(snapshot.handsWonCount) > 0 ||
  toAmount(snapshot.vpipHandsCount) > 0;

export const shouldIncludeLiveRankingPlayer = (
  player: LiveRankingPlayerLike,
): boolean => {
  if (!player.isRobot) {
    return true;
  }

  const tableStack = toAmount(player.chips) + toAmount(player.currentBet);
  if (player.status !== "left") {
    return true;
  }

  return hasTrackedActivity(player) || tableStack > 0;
};

export const shouldIncludeArchivedRankingParticipant = (
  participant: ArchivedRankingParticipantLike,
): boolean => {
  if (!participant.isRobot) {
    return true;
  }

  return hasTrackedActivity(participant) || toAmount(participant.finalChips) > 0;
};
