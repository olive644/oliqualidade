import { getRouteApi } from "@tanstack/react-router";

import { OliAm } from "@/routes/index";

const painelRouteApi = getRouteApi("/painel/$id");

export function PainelRouteComponent() {
  const { id } = painelRouteApi.useParams();
  return <OliAm routeId={id} />;
}
