import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Config separada do vite.config.ts principal: este projeto usa os plugins
// do TanStack Start, Nitro e outros plugins de build/SSR, desnecessários (e
// pesados) para rodar testes. Aqui só precisamos resolver o alias "@/*" do
// tsconfig, exatamente como no build real.
//
// São dois projetos porque os dois tipos de teste têm exigências opostas.
// Teste de função pura roda em Node, sem DOM e sem transformar JSX, e é a
// maioria esmagadora da suíte — carregar jsdom para todos custaria segundos
// em cada execução sem servir a nenhum deles. Teste de componente precisa de
// DOM e do plugin do React, e é reconhecido pela extensão `.test.tsx`.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "unidade",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "componente",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/component-setup.ts"],
        },
      },
    ],
  },
});
