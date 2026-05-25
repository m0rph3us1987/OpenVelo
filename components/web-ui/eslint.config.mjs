import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "dist-server/**", "node_modules/**"],
  },
]);

export default eslintConfig;
