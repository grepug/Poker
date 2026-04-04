import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card as PokerCard, HandEvaluation } from "poker-types";
import { HandResultsContent } from "@/components/poker/hand-results-content";
import { HandResultsModal } from "@/components/poker/hand-results-modal";
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
  title: "Poker/HandResultsModal",
  component: HandResultsModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    ariaLabel: "Hand results",
    onClose: () => {},
    t: storyTranslate,
  },
  render: (args) => (
    <HandResultsModal {...args}>
      <HandResultsContent
        currentHandNumber={22}
        totalPot={480}
        winnerCount={1}
        myNetChange={240}
        showNetChange
        currentPlayerId="p1"
        communityCards={communityCards}
        payoutBreakdownRows={[
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
        ]}
        handResultRows={[
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
        ]}
        revealedHandPlayerIdSet={new Set(["p1"])}
        onSaveResultScreenshot={() => {}}
        describeEvaluatedHand={(hand) => `${hand.rank} - ${hand.description}`}
        t={storyTranslate}
      />
    </HandResultsModal>
  ),
} satisfies Meta<typeof HandResultsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
