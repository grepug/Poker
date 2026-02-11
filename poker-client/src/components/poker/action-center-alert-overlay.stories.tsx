import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionCenterAlertOverlay } from "@/components/poker/action-center-alert-overlay";

const meta = {
  title: "Poker/ActionCenterAlertOverlay",
  component: ActionCenterAlertOverlay,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    pointerVector: {
      x: 20,
      y: 14,
      angle: -10,
      length: 90,
    },
    actor: "Kai",
    title: "Raises to $120",
    tone: "aggressive",
    exiting: false,
    cardRef: React.createRef<HTMLDivElement>(),
  },
} satisfies Meta<typeof ActionCenterAlertOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Aggressive: Story = {};

export const Folded: Story = {
  args: {
    tone: "fold",
    title: "Folded",
    pointerVector: null,
  },
};
