import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  // GitHub Pages serves this under /spendguard/, so asset URLs must be relative.
  base: "./",
  // Built output goes to docs/ so GitHub Pages can serve it straight from the branch.
  build: { outDir: "../docs", emptyOutDir: true, target: "es2022" },
  server: { fs: { allow: [".."] } },
});
