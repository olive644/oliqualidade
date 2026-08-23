import type { WidgetEvidence } from "@/lib/widget-evidence";
import { WidgetEvidenceContext } from "./widget-evidence-state";

export function WidgetEvidenceProvider({
  evidence,
  children,
}: {
  evidence: WidgetEvidence | null;
  children: React.ReactNode;
}) {
  return (
    <WidgetEvidenceContext.Provider value={evidence}>{children}</WidgetEvidenceContext.Provider>
  );
}
