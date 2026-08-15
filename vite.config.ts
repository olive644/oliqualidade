import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tanstackStart({
      // Redireciona o server entry embutido do TanStack Start para
      // src/server.ts (nosso wrapper de erro de SSR). nitro/vite builda a
      // partir daqui.
      server: { entry: "server" },
    }),
    viteReact(),
    tailwindcss(),
    // Plugin de build do Nitro; gera o output de servidor (preset Cloudflare
    // por padrão, ajuste "preset" aqui se o alvo de deploy mudar).
    nitro({ preset: "vercel" }),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  build: {
    rollupOptions: {
      output: {
        // Sem isso, o Rolldown consolida o recharts (biblioteca pesada de
        // gráficos) dentro do maior chunk de rota alcançável a partir dele,
        // em vez de mantê-lo como um chunk de vendor cacheável à parte —
        // sensível a qual arquivo vira o "módulo fachada" do grafo de
        // dependências compartilhadas, o que muda ao dividir routes/index.tsx
        // em vários arquivos sem alterar o grafo de módulos em si.
        manualChunks(id) {
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "recharts-vendor";
          }
          if (
            id.includes("node_modules/@radix-ui") ||
            id.includes("node_modules/@floating-ui") ||
            id.includes("node_modules/cmdk") ||
            id.includes("node_modules/sonner")
          ) {
            return "radix-vendor";
          }
          return undefined;
        },
      },
    },
  },
});
