import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = async () => {
  const queryClient = new QueryClient();

  // import() dinâmico atrás de um guard estático (import.meta.env.SSR) pra
  // esse módulo nunca entrar no bundle do navegador — este arquivo é
  // compartilhado entre servidor e cliente (hidratação), mas
  // lib/csp-nonce.ts usa node:async_hooks/node:crypto, inválidos no browser.
  const nonce = import.meta.env.SSR ? (await import("./lib/csp-nonce")).currentNonce() : undefined;

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ...(nonce ? { ssr: { nonce } } : {}),
  });

  return router;
};
