import { createContext, useContext } from "react";
import type { WidgetEvidence } from "@/lib/widget-evidence";

export const WidgetEvidenceContext = createContext<WidgetEvidence | null>(null);

export const useWidgetEvidence = () => useContext(WidgetEvidenceContext);
