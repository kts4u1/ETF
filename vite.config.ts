import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/web",
  publicDir: "../../public",
  // 상대 경로 빌드: GitHub Pages 등 하위 경로 정적 호스팅에서도 동작
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true, sourcemap: false },
  test: {
    root: ".",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
});
