import { Card, HandEvaluation, HandRank, Rank } from 'poker-types';
import { getRankValue } from './deck';

// Category scores must dominate kicker scores. Kicker encoding can reach ~1.5e9,
// so keep category gaps comfortably larger than that.
const CATEGORY_BASE = 10_000_000_000;

/**
 * Evaluate a poker hand from any number of cards (typically 5-7)
 * Returns the best 5-card hand possible
 */
export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards to evaluate a hand');
  }

  // Generate all possible 5-card combinations
  const combinations = get5CardCombinations(cards);

  // Evaluate each combination and return the best
  let bestHand: HandEvaluation | null = null;

  for (const combo of combinations) {
    const evaluation = evaluate5CardHand(combo);
    if (!bestHand || evaluation.value > bestHand.value) {
      bestHand = evaluation;
    }
  }

  return bestHand!;
}

/**
 * Generate all 5-card combinations from a set of cards
 */
function get5CardCombinations(cards: Card[]): Card[][] {
  const combinations: Card[][] = [];

  function combine(start: number, combo: Card[]) {
    if (combo.length === 5) {
      combinations.push([...combo]);
      return;
    }

    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }

  combine(0, []);
  return combinations;
}

/**
 * Evaluate exactly 5 cards
 */
function evaluate5CardHand(cards: Card[]): HandEvaluation {
  const sorted = [...cards].sort(
    (a, b) => getRankValue(b.rank) - getRankValue(a.rank),
  );

  // Check for each hand type from highest to lowest
  if (isRoyalFlush(sorted)) {
    return {
      rank: 'ROYAL_FLUSH',
      value: 10 * CATEGORY_BASE,
      cards: sorted,
      description: 'Royal Flush',
    };
  }

  const straightFlush = isStraightFlush(sorted);
  if (straightFlush) {
    return {
      rank: 'STRAIGHT_FLUSH',
      value: 9 * CATEGORY_BASE + straightFlush.highCard,
      cards: sorted,
      description: `Straight Flush, ${straightFlush.highCard} high`,
    };
  }

  const fourOfAKind = isFourOfAKind(sorted);
  if (fourOfAKind) {
    return {
      rank: 'FOUR_OF_A_KIND',
      value: 8 * CATEGORY_BASE + fourOfAKind.quadValue * 100 + fourOfAKind.kicker,
      cards: sorted,
      description: `Four ${fourOfAKind.quadRank}s`,
    };
  }

  const fullHouse = isFullHouse(sorted);
  if (fullHouse) {
    return {
      rank: 'FULL_HOUSE',
      value: 7 * CATEGORY_BASE + fullHouse.tripValue * 100 + fullHouse.pairValue,
      cards: sorted,
      description: `Full House, ${fullHouse.tripRank}s over ${fullHouse.pairRank}s`,
    };
  }

  const flush = isFlush(sorted);
  if (flush) {
    return {
      rank: 'FLUSH',
      value: 6 * CATEGORY_BASE + flush.value,
      cards: sorted,
      description: 'Flush',
    };
  }

  const straight = isStraight(sorted);
  if (straight) {
    return {
      rank: 'STRAIGHT',
      value: 5 * CATEGORY_BASE + straight.highCard,
      cards: sorted,
      description: `Straight, ${straight.highCard} high`,
    };
  }

  const threeOfAKind = isThreeOfAKind(sorted);
  if (threeOfAKind) {
    return {
      rank: 'THREE_OF_A_KIND',
      value:
        4 * CATEGORY_BASE +
        threeOfAKind.tripValue * 10000 +
        threeOfAKind.kickers,
      cards: sorted,
      description: `Three ${threeOfAKind.tripRank}s`,
    };
  }

  const twoPair = isTwoPair(sorted);
  if (twoPair) {
    return {
      rank: 'TWO_PAIR',
      value:
        3 * CATEGORY_BASE +
        twoPair.highPair * 10000 +
        twoPair.lowPair * 100 +
        twoPair.kicker,
      cards: sorted,
      description: `Two Pair, ${twoPair.highRank}s and ${twoPair.lowRank}s`,
    };
  }

  const onePair = isOnePair(sorted);
  if (onePair) {
    return {
      rank: 'ONE_PAIR',
      value: 2 * CATEGORY_BASE + onePair.pairValue * 10000 + onePair.kickers,
      cards: sorted,
      description: `Pair of ${onePair.pairRank}s`,
    };
  }

  // High card
  const highCardValue = calculateKickers(sorted.map((c) => c.rank));
  return {
    rank: 'HIGH_CARD',
    value: 1 * CATEGORY_BASE + highCardValue,
    cards: sorted,
    description: `High Card ${sorted[0].rank}`,
  };
}

/**
 * Check if hand is a royal flush (A, K, Q, J, 10 of same suit)
 */
function isRoyalFlush(cards: Card[]): boolean {
  if (!isFlush(cards)) return false;

  const ranks = new Set(cards.map((c) => c.rank));
  return (
    ranks.has('A') &&
    ranks.has('K') &&
    ranks.has('Q') &&
    ranks.has('J') &&
    ranks.has('10')
  );
}

/**
 * Check if hand is a straight flush
 */
function isStraightFlush(cards: Card[]): { highCard: number } | null {
  if (!isFlush(cards)) return null;
  return isStraight(cards);
}

/**
 * Check if hand is four of a kind
 */
function isFourOfAKind(
  cards: Card[],
): { quadValue: number; quadRank: Rank; kicker: number } | null {
  const rankCounts = getRankCounts(cards);

  for (const [rank, count] of Object.entries(rankCounts)) {
    if (count === 4) {
      const kicker = cards.find((c) => c.rank !== rank)!;
      return {
        quadValue: getRankValue(rank as Rank),
        quadRank: rank as Rank,
        kicker: getRankValue(kicker.rank),
      };
    }
  }

  return null;
}

/**
 * Check if hand is a full house
 */
function isFullHouse(
  cards: Card[],
): {
  tripValue: number;
  tripRank: Rank;
  pairValue: number;
  pairRank: Rank;
} | null {
  const rankCounts = getRankCounts(cards);

  let tripRank: Rank | null = null;
  let pairRank: Rank | null = null;

  for (const [rank, count] of Object.entries(rankCounts)) {
    if (count === 3) tripRank = rank as Rank;
    if (count === 2) pairRank = rank as Rank;
  }

  if (tripRank && pairRank) {
    return {
      tripValue: getRankValue(tripRank),
      tripRank,
      pairValue: getRankValue(pairRank),
      pairRank,
    };
  }

  return null;
}

/**
 * Check if hand is a flush
 */
function isFlush(cards: Card[]): { value: number } | null {
  const suit = cards[0].suit;
  if (cards.every((c) => c.suit === suit)) {
    const value = calculateKickers(cards.map((c) => c.rank));
    return { value };
  }
  return null;
}

/**
 * Check if hand is a straight
 */
function isStraight(cards: Card[]): { highCard: number } | null {
  const values = cards.map((c) => getRankValue(c.rank)).sort((a, b) => b - a);

  // Check for normal straight
  let isStraight = true;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] - values[i + 1] !== 1) {
      isStraight = false;
      break;
    }
  }

  if (isStraight) {
    return { highCard: values[0] };
  }

  // Check for A-2-3-4-5 (wheel)
  const ranks = cards.map((c) => c.rank).sort();
  if (ranks.join(',') === '2,3,4,5,A') {
    return { highCard: 5 }; // In wheel, 5 is high card
  }

  return null;
}

/**
 * Check if hand is three of a kind
 */
function isThreeOfAKind(
  cards: Card[],
): { tripValue: number; tripRank: Rank; kickers: number } | null {
  const rankCounts = getRankCounts(cards);

  for (const [rank, count] of Object.entries(rankCounts)) {
    if (count === 3) {
      const kickers = cards.filter((c) => c.rank !== rank).map((c) => c.rank);
      return {
        tripValue: getRankValue(rank as Rank),
        tripRank: rank as Rank,
        kickers: calculateKickers(kickers),
      };
    }
  }

  return null;
}

/**
 * Check if hand is two pair
 */
function isTwoPair(
  cards: Card[],
): {
  highPair: number;
  highRank: Rank;
  lowPair: number;
  lowRank: Rank;
  kicker: number;
} | null {
  const rankCounts = getRankCounts(cards);

  const pairs: Rank[] = [];
  for (const [rank, count] of Object.entries(rankCounts)) {
    if (count === 2) pairs.push(rank as Rank);
  }

  if (pairs.length === 2) {
    const sorted = pairs.sort((a, b) => getRankValue(b) - getRankValue(a));
    const kicker = cards.find((c) => !pairs.includes(c.rank))!;

    return {
      highPair: getRankValue(sorted[0]),
      highRank: sorted[0],
      lowPair: getRankValue(sorted[1]),
      lowRank: sorted[1],
      kicker: getRankValue(kicker.rank),
    };
  }

  return null;
}

/**
 * Check if hand is one pair
 */
function isOnePair(
  cards: Card[],
): { pairValue: number; pairRank: Rank; kickers: number } | null {
  const rankCounts = getRankCounts(cards);

  for (const [rank, count] of Object.entries(rankCounts)) {
    if (count === 2) {
      const kickers = cards.filter((c) => c.rank !== rank).map((c) => c.rank);
      return {
        pairValue: getRankValue(rank as Rank),
        pairRank: rank as Rank,
        kickers: calculateKickers(kickers),
      };
    }
  }

  return null;
}

/**
 * Get count of each rank in hand
 */
function getRankCounts(cards: Card[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }
  return counts;
}

/**
 * Calculate kicker value from ranks (for tie-breaking)
 */
function calculateKickers(ranks: Rank[]): number {
  const sorted = [...ranks].sort((a, b) => getRankValue(b) - getRankValue(a));
  let value = 0;
  for (let i = 0; i < sorted.length; i++) {
    value += getRankValue(sorted[i]) * Math.pow(15, sorted.length - 1 - i);
  }
  return value;
}

/**
 * Compare two hands and return:
 * - Positive if hand1 wins
 * - Negative if hand2 wins
 * - 0 if tie
 */
export function compareHands(
  hand1: HandEvaluation,
  hand2: HandEvaluation,
): number {
  return hand1.value - hand2.value;
}
