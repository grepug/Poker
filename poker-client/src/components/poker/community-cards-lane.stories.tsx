import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommunityCardsLane } from "@/components/poker/community-cards-lane";

const meta = {
  title: "Poker/CommunityCardsLane",
  component: CommunityCardsLane,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    children: (
      <>
        <div className="table-card">A♠</div>
        <div className="table-card">K♥</div>
        <div className="table-card">Q♣</div>
        <div className="table-card">J♦</div>
        <div className="table-card">10♠</div>
      </>
    ),
  },
} satisfies Meta<typeof CommunityCardsLane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullBoard: Story = {};

export const FlopOnly: Story = {
  args: {
    children: (
      <>
        <div className="table-card">9♠</div>
        <div className="table-card">9♥</div>
        <div className="table-card">2♣</div>
      </>
    ),
  },
};

