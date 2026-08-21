import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

import {
  ErrorComponent,
  NotFoundComponent,
  RootComponent,
  RootShell,
} from "@/components/oliam/root-route-components";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Oli.Qualidade" },
      { name: "theme-color", content: "#0A8A8D" },
      { name: "format-detection", content: "telephone=no" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Oli.Qualidade" },
      {
        name: "description",
        content: "BI preciso para planilhas, com múltiplos painéis e modo escuro.",
      },
      { property: "og:title", content: "Oli.Qualidade" },
      {
        property: "og:description",
        content: "BI preciso para planilhas, com múltiplos painéis e modo escuro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/oli-mark.svg", type: "image/svg+xml" },
      { rel: "shortcut icon", href: "/oli-mark.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/oli-mark.svg" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});
