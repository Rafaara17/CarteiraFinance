/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` precisa apontar para o caminho do GitHub Pages de projeto:
//   https://<usuario>.github.io/<repo>/  ->  base = "/<repo>/"
// Ajustável via env BASE_PATH no workflow de deploy.
const base = process.env.BASE_PATH ?? "/CarteiraFinance/";

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
