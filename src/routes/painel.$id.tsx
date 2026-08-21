import { createFileRoute } from "@tanstack/react-router";

import { PainelRouteComponent } from "@/components/oliam/painel-route-component";

export const Route = createFileRoute("/painel/$id")({
  head: () => ({
    meta: [
      { title: "Oli.Qualidade, painel" },
      {
        name: "description",
        content: "Relatório configurável a partir de planilhas, com gráficos interativos.",
      },
    ],
  }),
  component: PainelRouteComponent,
});
