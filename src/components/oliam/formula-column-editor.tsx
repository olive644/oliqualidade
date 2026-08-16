import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateFormula } from "@/lib/format";
import type { Column } from "@/lib/types";

/**
 * Botão + formulário inline para criar uma coluna calculada a partir de uma
 * fórmula simples sobre as colunas existentes. Autocontido: o próprio
 * componente decide quando mostrar o botão ou o formulário, o chamador só
 * recebe a lista de colunas final via `onAddColumn`.
 */
export function FormulaColumnEditor({
  columns,
  onAddColumn,
}: {
  columns: Column[];
  onAddColumn: (columns: Column[]) => void;
}) {
  const [addingFormula, setAddingFormula] = useState(false);
  const [formulaLabel, setFormulaLabel] = useState("");
  const [formulaText, setFormulaText] = useState("");
  const [formulaError, setFormulaError] = useState<string | null>(null);

  if (!addingFormula) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setAddingFormula(true)}>
        <Calculator className="size-4" />
        Nova coluna calculada
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <input
        className="oliam-input w-full"
        placeholder="Nome da coluna, ex: Lucro"
        value={formulaLabel}
        onChange={(e) => setFormulaLabel(e.target.value)}
      />
      <input
        className="oliam-input w-full font-mono text-xs"
        placeholder="Fórmula, ex: receita - custo"
        value={formulaText}
        onChange={(e) => setFormulaText(e.target.value)}
      />
      {formulaError && <p className="text-xs text-destructive">{formulaError}</p>}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAddingFormula(false);
            setFormulaError(null);
          }}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const availableKeys = columns.map((c) => c.key);
            const error = validateFormula(formulaText, availableKeys);
            if (error) {
              setFormulaError(error);
              return;
            }
            const label = formulaLabel.trim() || "Coluna calculada";
            const key = `calc_${label
              .toLowerCase()
              .replaceAll(/[^a-z0-9]+/g, "_")}_${Date.now().toString(36)}`;
            onAddColumn([
              ...columns,
              {
                key,
                label,
                kind: "number",
                visible: true,
                description: `Calculada a partir de: ${formulaText}`,
                formula: formulaText,
              },
            ]);
            setAddingFormula(false);
            setFormulaLabel("");
            setFormulaText("");
            setFormulaError(null);
          }}
        >
          Criar coluna
        </Button>
      </div>
    </div>
  );
}
