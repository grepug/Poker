import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionCenterAlert } from "@/components/poker/action-center-alert";

const meta = {
  title: "Poker/ActionCenterAlert",
  component: ActionCenterAlert,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    eyebrow: "LAST ACTION",
    actor: "Kai",
    title: "Raise to $80",
    tone: "aggressive",
    exiting: false,
  },
} satisfies Meta<typeof ActionCenterAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Exiting: Story = {
  args: {
    exiting: true,
    tone: "fold",
    title: "Fold",
  },
};

