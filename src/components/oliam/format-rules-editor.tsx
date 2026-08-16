import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseNumericValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Column, ConditionalFormatRule } from "@/lib/types";

const thresholdOperatorLabel: Record<string, string> = {
  lt: "menor que",
  lte: "menor ou igual a",
  gt: "maior que",
  gte: "maior ou igual a",
};

export function FormatRulesEditor({
  column,
  onChange,
}: {
  column: Column;
  onChange: (rules: ConditionalFormatRule[]) => void;
}) {
  const [adding, setAdding] = useState<"threshold" | "scale" | null>(null);
  const [operator, setOperator] = useState<"lt" | "lte" | "gt" | "gte">("lt");
  const [value, setValue] = useState("");
  const [color, setColor] = useState("#c0392b");
  const [background, setBackground] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [minColor, setMinColor] = useState("#dbeafe");
  const [maxColor, setMaxColor] = useState("#1d4ed8");
  const rules = column.conditionalFormat ?? [];
  const canAddRule =
    adding === "threshold"
      ? value.trim() !== "" && parseNumericValue(value) !== null
      : adding === "scale"
        ? min.trim() !== "" &&
          max.trim() !== "" &&
          parseNumericValue(min) !== null &&
          parseNumericValue(max) !== null &&
          (parseNumericValue(max) ?? 0) > (parseNumericValue(min) ?? 0)
        : false;

  const cancel = () => {
    setAdding(null);
    setValue("");
    setMin("");
    setMax("");
  };
  const addRule = () => {
    if (adding === "threshold") {
      const num = parseNumericValue(value);
      if (!value.trim() || num === null) return;
      onChange([
        ...rules,
        { id: crypto.randomUUID(), type: "threshold", operator, value: num, color, background },
      ]);
    } else if (adding === "scale") {
      const mn = parseNumericValue(min),
        mx = parseNumericValue(max);
      if (!min.trim() || !max.trim() || mn === null || mx === null || mx <= mn) return;
      onChange([
        ...rules,
        { id: crypto.randomUUID(), type: "scale", min: mn, max: mx, minColor, maxColor },
      ]);
    }
    cancel();
  };

  return (
    <div className="border-b p-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="truncate">{column.label}</span>
        {adding === null && (
          <button
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Adicionar regra de formatação para ${column.label}`}
            onClick={() => setAdding("threshold")}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {rules.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
            >
              <span className="flex items-center gap-1.5 truncate">
                <span
                  className="inline-block size-2.5 shrink-0 border"
                  style={{
                    background:
                      r.type === "threshold"
                        ? r.color
                        : `linear-gradient(90deg, ${r.minColor}, ${r.maxColor})`,
                  }}
                />
                {r.type === "threshold"
                  ? `${thresholdOperatorLabel[r.operator ?? "lt"]} ${r.value}${r.background ? ", fundo" : ""}`
                  : `escala de ${r.min} a ${r.max}`}
              </span>
              <button
                aria-label="Remover regra"
                onClick={() => onChange(rules.filter((x) => x.id !== r.id))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-2 space-y-2 border bg-accent/40 p-2">
          <div className="flex gap-2">
            <button
              className={cn("oliam-select flex-1", adding === "threshold" && "border-primary")}
              onClick={() => setAdding("threshold")}
            >
              Limite
            </button>
            <button
              className={cn("oliam-select flex-1", adding === "scale" && "border-primary")}
              onClick={() => setAdding("scale")}
            >
              Escala
            </button>
          </div>
          {adding === "threshold" ? (
            <>
              <div className="flex gap-2">
                <select
                  className="oliam-select flex-1"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as typeof operator)}
                >
                  <option value="lt">menor que</option>
                  <option value="lte">menor ou igual a</option>
                  <option value="gt">maior que</option>
                  <option value="gte">maior ou igual a</option>
                </select>
                <input
                  className="oliam-input w-20"
                  type="number"
                  placeholder="valor"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                Cor
                <span className="ml-auto flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={background}
                    onChange={(e) => setBackground(e.target.checked)}
                  />
                  aplicar no fundo
                </span>
              </label>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  className="oliam-input w-full"
                  type="number"
                  placeholder="mínimo"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                />
                <input
                  className="oliam-input w-full"
                  type="number"
                  placeholder="máximo"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={minColor}
                    onChange={(e) => setMinColor(e.target.value)}
                  />
                  cor mínima
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={maxColor}
                    onChange={(e) => setMaxColor(e.target.value)}
                  />
                  cor máxima
                </label>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancelar
            </Button>
            <Button size="sm" disabled={!canAddRule} onClick={addRule}>
              Adicionar regra
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
