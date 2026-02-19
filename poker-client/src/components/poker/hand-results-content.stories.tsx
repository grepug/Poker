import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card as PokerCard, HandEvaluation } from "poker-types";
import { HandResultsPanel } from "@/components/poker/hand-results-panel";
import { HandResultsContent } from "@/components/poker/hand-results-content";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const communityCards: Array<PokerCard | null> = [
  { rank: "A", suit: "spades" },
  { rank: "Q", suit: "spades" },
  { rank: "J", suit: "spades" },
  { rank: "10", suit: "spades" },
  { rank: "2", suit: "hearts" },
];

const straightFlush: HandEvaluation = {
  rank: "STRAIGHT_FLUSH",
  value: 10,
  cards: [
    { rank: "A", suit: "spades" },
    { rank: "K", suit: "spades" },
    { rank: "Q", suit: "spades" },
    { rank: "J", suit: "spades" },
    { rank: "10", suit: "spades" },
  ],
  description: "Straight Flush, A high",
};

const pair: HandEvaluation = {
  rank: "ONE_PAIR",
  value: 2,
  cards: [
    { rank: "A", suit: "diamonds" },
    { rank: "A", suit: "clubs" },
    { rank: "Q", suit: "hearts" },
    { rank: "10", suit: "clubs" },
    { rank: "2", suit: "spades" },
  ],
  description: "Pair of As",
};

const meta = {
  title: "Poker/HandResultsContent",
  component: HandResultsContent,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    currentHandNumber: 22,
    totalPot: 480,
    winnerCount: 1,
    myNetChange: 240,
    showNetChange: true,
    currentPlayerId: "p1",
    communityCards,
    payoutBreakdownRows: [
      {
        segmentIndex: 0,
        label: "Main Pot",
        amount: 360,
        uncontested: false,
        winnerShares: [
          {
            playerId: "p1",
            playerName: "Kai",
            amountWon: 360,
          },
        ],
      },
    ],
    handResultRows: [
      {
        playerId: "p1",
        playerName: "Kai",
        rankOrder: 1,
        isWinner: true,
        amountWon: 360,
        netChange: 240,
        cards: [
          { rank: "K", suit: "spades" },
          { rank: "9", suit: "spades" },
        ],
        hand: straightFlush,
        resultStatus: "shown",
        cardsVisibility: "shown",
        seatPosition: 0,
      },
      {
        playerId: "p2",
        playerName: "Maya",
        rankOrder: 2,
        isWinner: false,
        amountWon: 0,
        netChange: -120,
        cards: [
          { rank: "A", suit: "diamonds" },
          { rank: "A", suit: "clubs" },
        ],
        hand: pair,
        resultStatus: "hidden_contender",
        cardsVisibility: "hidden",
        seatPosition: 1,
      },
    ],
    revealedHandPlayerIdSet: new Set(["p1"]),
    onSaveResultScreenshot: () => {},
    describeEvaluatedHand: (hand) => `${hand.rank} - ${hand.description}`,
    t: storyTranslate,
  },
  render: (args) => (
    <div style={{ width: 760 }}>
      <HandResultsPanel>
        <HandResultsContent {...args} />
      </HandResultsPanel>
    </div>
  ),
} satisfies Meta<typeof HandResultsContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EveryoneRevealed: Story = {
  args: {
    revealedHandPlayerIdSet: new Set(["p1", "p2"]),
  },
};
