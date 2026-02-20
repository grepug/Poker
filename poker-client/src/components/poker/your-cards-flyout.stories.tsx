import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card as PokerCard } from "poker-types";
import { YourCardsFlyout } from "@/components/poker/your-cards-flyout";

const holeCards: PokerCard[] = [
  { rank: "A", suit: "spades" },
  { rank: "K", suit: "spades" },
];

const meta = {
  title: "Poker/YourCardsFlyout",
  component: YourCardsFlyout,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    isOpen: true,
    hasHoleCards: true,
    cards: holeCards,
    shouldAnchorToBottomBar: false,
    bottomBarHeight: 220,
    title: "Your Cards",
    emptyOpenStateLabel: "Cards appear when hand starts",
    emptyClosedStateLabel: "Hide Your Cards",
    hideLabel: "Hide",
    showLabel: "Show",
    onToggle: () => {},
  },
} satisfies Meta<typeof YourCardsFlyout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Collapsed: Story = {
  args: {
    isOpen: false,
  },
};

export const Empty: Story = {
  args: {
    hasHoleCards: false,
    cards: [],
  },
};
