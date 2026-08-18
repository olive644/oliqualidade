import { cn } from "@/lib/utils";
import type { ConfidenceLevel } from "@/lib/import-intelligence";

/** Ponto colorido alta/média/baixa, usado tanto pelas abas quanto pelas
 * colunas na revisão de importação — mesmo mapeamento de cor em ambos. */
export function ConfidenceDot({
  level,
  className,
}: {
  level: ConfidenceLevel;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full align-middle",
        level === "alta" ? "bg-emerald-500" : level === "média" ? "bg-amber-500" : "bg-rose-500",
        className,
      )}
    />
  );
}
