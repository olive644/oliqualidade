import { CircleCheck, CircleHelp, FileSpreadsheet, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CellProvenance } from "@/lib/cell-provenance";
import { cn } from "@/lib/utils";

const statusMeta = {
  exact: {
    label: "Origem confirmada",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: CircleCheck,
  },
  inferred: {
    label: "Origem provável",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: CircleHelp,
  },
  unavailable: {
    label: "Origem não localizada",
    className: "border-border bg-muted text-muted-foreground",
    icon: CircleHelp,
  },
} as const;

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Sem valor";
  if (typeof value === "boolean") return value ? "Verdadeiro" : "Falso";
  return String(value);
}

export function CellProvenancePanel({
  provenance,
  close,
}: {
  provenance: CellProvenance;
  close: () => void;
}) {
  const status = statusMeta[provenance.status];
  const StatusIcon = status.icon;
  const location = [
    provenance.fileName,
    provenance.sheetName,
    provenance.section,
    provenance.sourceAddress,
  ]
    .filter(Boolean)
    .join(" › ");

  return (
    <aside
      className="mt-3 rounded-xl border border-border bg-background p-4"
      aria-live="polite"
      aria-label="Origem da célula selecionada"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 shrink-0 text-primary" />
            <h3 className="text-sm font-semibold">Origem da célula</h3>
          </div>
          <p className="mt-1 break-words text-xs text-muted-foreground">{location}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
              status.className,
            )}
          >
            <StatusIcon className="size-3" />
            {status.label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={close}
            aria-label="Fechar origem da célula"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <dl className="mt-4 grid border-y border-border text-xs sm:grid-cols-2">
        <div className="py-3 sm:border-r sm:border-border sm:pr-4">
          <dt className="text-muted-foreground">Valor na planilha</dt>
          <dd className="mt-1 break-words font-medium">{valueLabel(provenance.rawValue)}</dd>
          {provenance.displayValue &&
            provenance.displayValue !== valueLabel(provenance.rawValue) && (
              <dd className="mt-1 break-words text-muted-foreground">
                Exibido pelo Excel: {provenance.displayValue}
              </dd>
            )}
        </div>
        <div className="border-t border-border py-3 sm:border-t-0 sm:pl-4">
          <dt className="text-muted-foreground">Valor importado</dt>
          <dd className="mt-1 break-words font-medium">
            {valueLabel(provenance.importedValue)}
          </dd>
          <dd className="mt-1 text-muted-foreground">
            {provenance.normalized ? "Valor normalizado" : "Valor preservado"}
          </dd>
        </div>
        <div className="border-t border-border py-3 sm:border-r sm:pr-4">
          <dt className="text-muted-foreground">Interpretação</dt>
          <dd className="mt-1 font-medium">{provenance.inferredKind}</dd>
          <dd className="mt-1 text-muted-foreground">
            Confiança da coluna:{" "}
            {provenance.columnConfidence === null
              ? "não calculada"
              : provenance.columnConfidence + "%"}
            {" · "}
            confiança da aba:{" "}
            {provenance.sheetConfidence === null
              ? "não calculada"
              : provenance.sheetConfidence + "%"}
          </dd>
        </div>
        <div className="border-t border-border py-3 sm:pl-4">
          <dt className="text-muted-foreground">Vínculo com a origem</dt>
          <dd className="mt-1 font-medium">
            {provenance.sourceAddress ?? "Endereço indisponível"}
          </dd>
          <dd className="mt-1 text-muted-foreground">
            Confiança do vínculo: {provenance.mappingConfidence}%
          </dd>
        </div>
      </dl>

      {(provenance.formula || provenance.numberFormat) && (
        <div className="grid gap-3 border-b border-border py-3 text-xs sm:grid-cols-2">
          {provenance.formula && (
            <div>
              <div className="text-muted-foreground">Fórmula original</div>
              <code className="mt-1 block break-all font-mono text-foreground">
                {provenance.formula}
              </code>
            </div>
          )}
          {provenance.numberFormat && (
            <div>
              <div className="text-muted-foreground">Formato do Excel</div>
              <code className="mt-1 block break-all font-mono text-foreground">
                {provenance.numberFormat}
              </code>
            </div>
          )}
        </div>
      )}

      <div className="pt-3 text-xs">
        <div className="font-medium">Como o vínculo foi determinado</div>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {provenance.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{reason}</span>
            </li>
          ))}
          {provenance.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-amber-700 dark:text-amber-300">
              <span aria-hidden="true">•</span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
