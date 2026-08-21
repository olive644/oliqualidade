import { createFileRoute } from "@tanstack/react-router";

import { OliAm } from "./index";

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
  component: RouteComponent,
});

export function RouteComponent() {
  const { id } = Route.useParams();
  return <OliAm routeId={id} />;
}
