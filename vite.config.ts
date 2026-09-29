import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  // Built output goes to docs/ so GitHub Pages can serve it straight from the branch.
  build: { outDir: "../docs", emptyOutDir: true, target: "es2022" },
  server: { fs: { allow: [".."] } },
});
