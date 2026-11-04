import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: ["build", ".react-router", "node_modules", "playwright-report", "test-results", "docs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  { files: ["**/*.{js,mjs}"], languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly", Buffer: "readonly", setTimeout: "readonly", AbortSignal: "readonly" } } },
);
