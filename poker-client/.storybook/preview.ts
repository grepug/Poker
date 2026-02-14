import type { Preview } from "@storybook/react-vite";
import "../src/index.css";

declare const __STORYBOOK_FAST_MODE__: boolean;

const isStorybookFastMode =
  typeof __STORYBOOK_FAST_MODE__ !== "undefined" && __STORYBOOK_FAST_MODE__;

const preview: Preview = {
  decorators: [
    (Story) => {
      const className = "sb-fast-mode";
      const root = document.documentElement;
      if (isStorybookFastMode) {
        root.classList.add(className);
      } else {
        root.classList.remove(className);
      }
      return Story();
    },
  ],

  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "fullscreen",
    backgrounds: {
      options: {
        "poker-dark": { name: "poker-dark", value: "#04130d" }
      }
    },
  },

  initialGlobals: {
    backgrounds: {
      value: "poker-dark"
    }
  }
};

export default preview;
