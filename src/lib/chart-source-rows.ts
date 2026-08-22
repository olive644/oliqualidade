/**
 * Linhas que produziram um ponto/balde de gráfico, seja ele agregado
 * (`sourceRowIndexes`, um por balde) ou bruto (`sourceRowIndex`, um por
 * linha). Vazio indica que o ponto não veio do pipeline rastreável.
 */
export function sourceRowIndexesOf(point: {
  name: string;
  total: number;
  sourceRow?: number;
  sourceRowIndex?: number;
  sourceRowIndexes?: number[];
}): number[] {
  return (
    point.sourceRowIndexes ?? (point.sourceRowIndex !== undefined ? [point.sourceRowIndex] : [])
  );
}
