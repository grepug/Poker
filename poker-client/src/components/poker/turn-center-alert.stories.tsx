import type { Meta, StoryObj } from "@storybook/react-vite";
import { TurnCenterAlert } from "@/components/poker/turn-center-alert";

const meta = {
  title: "Poker/TurnCenterAlert",
  component: TurnCenterAlert,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    eyebrow: "YOUR TURN",
    title: "Act within 30 seconds",
  },
} satisfies Meta<typeof TurnCenterAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

