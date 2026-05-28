import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_|^err$|^error$" },
      ],
    },
  },
  {
    files: ["src/widget.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        html2canvas: "readonly",
      },
    },
  },
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
  },
  {
    ignores: ["node_modules/"],
  },
];
