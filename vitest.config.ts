import { defineConfig } from "vitest/config";

// Config separada do vite.config.ts principal: este projeto usa os plugins
// do TanStack Start, Nitro e outros plugins de build/SSR, desnecessários (e
// pesados) para rodar testes de funções puras. Aqui só precisamos resolver o
// alias "@/*" do tsconfig, exatamente como no build real.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
