import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsModal } from "@/components/poker/settings-modal";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/SettingsModal",
  component: SettingsModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    locale: "en",
    onLocaleChange: () => {},
    isHost: true,
    isPlayerStreetRevealEnabled: false,
    onStreetRevealChange: () => {},
    onClose: () => {},
    t: storyTranslate,
  },
} satisfies Meta<typeof SettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HostSettings: Story = {};

export const GuestSettings: Story = {
  args: {
    isHost: false,
  },
};

