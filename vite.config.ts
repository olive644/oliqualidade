import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { writeFileSync } from "node:fs";
import type { Plugin } from "vite";

// Só roda com ANALYZE=1: escreve client-chunk-report.json com o mapeamento
// real de módulo -> chunk -> tamanho renderizado, restrito à saída do
// cliente (.vercel/output/static/assets), para investigar por que o
// bundler escolhe um "módulo fachada" diferente ao reorganizar arquivos
// (ver seções 45/51/57 do CURRENT_STATE_AUDIT.md). Nitro/Vercel gera o
// build do cliente e o build do servidor (SSR) na mesma invocação; o
// rollup-plugin-visualizer padrão sobrescreve o relatório entre os dois
// porque não distingue os dois destinos de saída, então isso é um plugin
// mínimo escrito à mão em vez disso, filtrando por `options.dir`.
function clientChunkReportPlugin(): Plugin {
  return {
    name: "client-chunk-report",
    generateBundle(options, bundle) {
      if (!options.dir?.includes("static")) return;
      const chunks = Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          renderedLength: chunk.code.length,
          modules: Object.entries(chunk.modules)
            .map(([id, mod]) => ({ id, renderedLength: mod.renderedLength }))
            .sort((a, b) => b.renderedLength - a.renderedLength),
        }))
        .sort((a, b) => b.renderedLength - a.renderedLength);
      writeFileSync("client-chunk-report.json", JSON.stringify(chunks, null, 2));
    },
  };
}

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
    ...(process.env["ANALYZE"] ? [clientChunkReportPlugin()] : []),
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
