import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const isFastMode = process.env.STORYBOOK_FAST_MODE === "1";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: isFastMode ? [] : ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    reactDocgen: isFastMode ? false : "react-docgen",
  },
  docs: {
    autodocs: isFastMode ? false : "tag",
  },
  viteFinal: async (config) =>
    mergeConfig(config, {
      define: {
        __STORYBOOK_FAST_MODE__: JSON.stringify(isFastMode),
      },
    }),
};

export default config;
