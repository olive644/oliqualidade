import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CellProvenancePanel } from "./cell-provenance-panel";
import { hydrateSourceCellProvenance, type SourceCellProvenance } from "@/lib/cell-provenance";
import type { Column, Row } from "@/lib/types";

/**
 * Painel aberto ao clicar em "Ver linhas de origem" num gráfico: lista as
 * linhas que produziram o valor selecionado (o balde de uma barra/fatia, ou
 * um único ponto no modo linha a linha) e, por linha, reaproveita
 * `CellProvenancePanel` para mostrar o endereço/fórmula reais na planilha —
 * quando `sourceCellProvenance` tem uma entrada pra ela. Sem entrada, a linha
 * é mostrada mesmo assim (o valor já está em `rows`); só a origem na
 * planilha original fica indisponível, o mesmo espírito de
 * `traceImportedCell`: célula sem vínculo não inventa um.
 */
export function SourceRowsPanel({
  open,
  onOpenChange,
  title,
  rowIndexes,
  column,
  rows,
  sourceCellProvenance,
  fileName,
  sheetName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rowIndexes: number[];
  column: Pick<Column, "key" | "kind" | "label">;
  rows: Row[];
  sourceCellProvenance: SourceCellProvenance[];
  fileName: string;
  sheetName: string;
}) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const provenanceByRow = new Map(
    sourceCellProvenance
      .filter((entry) => entry.columnKey === column.key)
      .map((entry) => [entry.rowIndex, entry]),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setExpandedRow(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Linhas de origem — {title}</DialogTitle>
          <DialogDescription>
            {rowIndexes.length === 1
              ? "1 linha contribuiu para este valor."
              : `${rowIndexes.length.toLocaleString("pt-BR")} linhas contribuíram para este valor.`}{" "}
            Clique numa linha para ver o vínculo com a célula original da planilha.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
          {rowIndexes.map((rowIndex) => {
            const row = rows[rowIndex];
            const provenance = provenanceByRow.get(rowIndex);
            const isExpanded = expandedRow === rowIndex;
            return (
              <li key={rowIndex} className="py-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                  onClick={() => setExpandedRow(isExpanded ? null : rowIndex)}
                  aria-expanded={isExpanded}
                >
                  <span className="text-muted-foreground">Linha {rowIndex + 1}</span>
                  <span className="truncate font-mono font-medium">
                    {row ? String(row[column.key] ?? "—") : "—"}
                  </span>
                </button>
                {isExpanded &&
                  (provenance ? (
                    <CellProvenancePanel
                      provenance={hydrateSourceCellProvenance(provenance, {
                        fileName,
                        sheetName,
                        rows,
                        column,
                      })}
                      close={() => setExpandedRow(null)}
                    />
                  ) : (
                    <p className="mt-2 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
                      Origem na planilha não disponível para esta célula — o formato do arquivo não
                      preserva a grade original, ou não foi possível vincular esta célula com
                      segurança.
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
