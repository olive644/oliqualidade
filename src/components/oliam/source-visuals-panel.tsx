import { BarChart3, PenTool } from "lucide-react";
import type { WorkbookChartDiagnostic, WorkbookShapeDiagnostic } from "@/lib/workbook-metadata";

/**
 * Inventário de gráficos e formas nativos do Excel, persistido no painel
 * (não só na revisão efêmera) — sobretudo relevante para abas sem nenhuma
 * linha de dado tabular, que não geram nenhum widget (ver `sheetsWithData`
 * em `import.ts`). Mesmo padrão de `SourceNotesPanel`: `<details>` autônomo,
 * `null` quando não há nada a mostrar.
 */
export function SourceVisualsPanel(p: {
  sourceShapes: WorkbookShapeDiagnostic[] | undefined;
  sourceCharts: WorkbookChartDiagnostic[] | undefined;
}) {
  const shapes = p.sourceShapes ?? [];
  const charts = p.sourceCharts ?? [];
  if (!shapes.length && !charts.length) return null;
  return (
    <>
      {shapes.length > 0 && (
        <details className="mx-4 mb-4 rounded-2xl border border-primary/20 bg-card shadow-sm md:mx-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
            <span className="inline-flex min-w-0 items-center gap-2">
              <PenTool className="size-4 shrink-0 text-primary" />
              <span className="truncate">Formas do Excel com texto</span>
            </span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              {shapes.length}
            </span>
          </summary>
          <ul className="grid max-h-72 gap-2 overflow-auto border-t border-border p-3 sm:grid-cols-2">
            {shapes.map((shape, index) => (
              <li
                key={`${shape.name}-${index}`}
                className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
              >
                <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                  {shape.anchor ?? "posição não determinada"} · {shape.name}
                </span>
                <span className="whitespace-pre-line break-words">{shape.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {charts.length > 0 && (
        <details className="mx-4 mb-4 rounded-2xl border border-primary/20 bg-card shadow-sm md:mx-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
            <span className="inline-flex min-w-0 items-center gap-2">
              <BarChart3 className="size-4 shrink-0 text-primary" />
              <span className="truncate">Gráficos nativos do Excel</span>
            </span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              {charts.length}
            </span>
          </summary>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Construídos no arquivo original a partir de referências de célula. Não são recalculados
            nem reproduzidos no painel.
          </p>
          <ul className="grid max-h-72 gap-2 overflow-auto border-t border-border p-3 sm:grid-cols-2">
            {charts.map((chart, index) => (
              <li
                key={`${chart.anchor}-${index}`}
                className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
              >
                <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                  {chart.anchor ?? "posição não determinada"} · {chart.type}
                </span>
                <span>{chart.title ?? "Sem título fixo (vinculado a célula ou sem legenda)"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
