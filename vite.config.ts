import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
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
    tsConfigPaths(),
    // Plugin de build do Nitro; gera o output de servidor (preset Cloudflare
    // por padrão, ajuste "preset" aqui se o alvo de deploy mudar).
    nitro({ preset: "cloudflare_module" }),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
});
