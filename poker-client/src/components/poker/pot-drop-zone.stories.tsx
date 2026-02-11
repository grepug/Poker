import type { Meta, StoryObj } from "@storybook/react-vite";
import { PotDropZone } from "@/components/poker/pot-drop-zone";

const meta = {
  title: "Poker/PotDropZone",
  component: PotDropZone,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    active: false,
    hover: false,
    label: "Main Pot",
    value: "$320",
    hint: "Drop chips here",
    pulse: false,
  },
} satisfies Meta<typeof PotDropZone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const ActiveHover: Story = {
  args: {
    active: true,
    hover: true,
    pulse: true,
  },
};

