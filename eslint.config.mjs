import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  AbortSignal: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

const browserGlobals = {
  HTMLElement: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  document: "readonly",
  setTimeout: "readonly",
  window: "readonly",
};

export default [
  {
    ignores: [
      "node_modules/**",
      "artifacts/**",
      "dist/**",
      "apps/*/dist/**",
      ".yarn/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: nodeGlobals,
    },
  },
  {
    files: ["apps/*/src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: browserGlobals,
    },
  },
  {
    files: ["apps/*/src/domain/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {},
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@evenrealities/*"],
              message:
                "Application domain logic must not import Even SDK packages directly (blueprint §3).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/*/test/**/*.ts", "apps/*/vite.config.ts"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: nodeGlobals,
    },
  },
];
