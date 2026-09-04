import type { ChartAxisKind, ChartDataMode } from "@/lib/types";
import { seriesAverage } from "@/lib/data-pipeline";

export type BarReadingPoint = { total: number; count?: number };

export type BarReading = {
  /**
   * Variação percentual em relação ao ponto anterior da série. Só existe em
   * eixo cronológico, onde "anterior" significa mesmo o período de antes.
   */
  changeFromPrevious: number | null;
  /**
   * Quanto o ponto representa da maior barra do gráfico, em porcentagem. Só
   * existe em eixo de categorias, e some quando o próprio ponto é o maior.
   */
  shareOfLargest: number | null;
  /** Quantos registros sustentam o ponto; null no modo linha a linha. */
  count: number | null;
};

const EMPTY_READING: BarReading = {
  changeFromPrevious: null,
  shareOfLargest: null,
  count: null,
};

/**
 * Traduz um ponto do gráfico de barras nas comparações que o tooltip pode
 * afirmar sem mentir.
 *
 * A regra que existe aqui é a separação por tipo de eixo. A variação contra o
 * vizinho anterior era mostrada em qualquer gráfico, inclusive nos de
 * categoria, que chegam ordenados da maior barra para a menor: ali o vizinho
 * anterior é apenas a categoria de valor mais alto, e a leitura "queda de
 * 18%" descrevia uma queda que nunca aconteceu. Em eixo de categorias a
 * comparação possível é com a maior barra, e ela é dita por extenso.
 *
 * A contagem de registros só aparece no modo agrupado porque, no modo linha a
 * linha, cada marca já é uma única linha da planilha e o número seria sempre 1.
 */
export function barTooltipReading({
  index,
  series,
  mode,
  axis,
}: {
  index: number;
  series: BarReadingPoint[];
  mode: ChartDataMode;
  axis: ChartAxisKind;
}): BarReading {
  const point = index >= 0 ? series[index] : undefined;
  if (!point) return EMPTY_READING;

  const previous = axis === "time" && index > 0 ? series[index - 1]?.total : undefined;
  const changeFromPrevious =
    typeof previous === "number" && previous !== 0
      ? ((point.total - previous) / Math.abs(previous)) * 100
      : null;

  const largest =
    axis === "category" ? Math.max(...series.map((entry) => Math.abs(entry.total)), 0) : 0;
  const shareOfLargest =
    largest > 0 && Math.abs(point.total) < largest ? (Math.abs(point.total) / largest) * 100 : null;

  return {
    changeFromPrevious,
    shareOfLargest,
    count: mode === "aggregate" && typeof point.count === "number" ? point.count : null,
  };
}

export type PeriodPointReading = {
  /** Variação percentual em relação ao ponto anterior da série. */
  changeFromPrevious: number | null;
  /** Quantos registros sustentam o ponto; null no modo linha a linha. */
  count: number | null;
  /**
   * Quanto o ponto está acima (positivo) ou abaixo (negativo) da média do
   * período, em porcentagem. `null` quando a série é curta demais para uma
   * média ter sentido (mesmo piso de `seriesAverage`) ou a média é zero.
   */
  vsAverage: number | null;
  /** O ponto é o maior valor do período — só quando há pelo menos 3 pontos. */
  isHighest: boolean;
  /** O ponto é o menor valor do período — só quando há pelo menos 3 pontos. */
  isLowest: boolean;
};

const EMPTY_PERIOD_READING: PeriodPointReading = {
  changeFromPrevious: null,
  count: null,
  vsAverage: null,
  isHighest: false,
  isLowest: false,
};

/**
 * Traduz um ponto de linha/área na mesma comparação com o vizinho anterior
 * que `barTooltipReading` já faz para o eixo cronológico do gráfico de
 * barras.
 *
 * Não existe aqui a separação por tipo de eixo que `barTooltipReading`
 * precisa: linha e área só desenham série temporal (a série já chega
 * ordenada cronologicamente), então a comparação com o ponto anterior é
 * sempre uma comparação com o período anterior de verdade — não há o caso
 * de eixo de categorias, onde o vizinho é só a maior barra.
 *
 * "Maior/menor valor do período" exige pelo menos 3 pontos pela mesma razão
 * que `seriesAverage` exige: com um ou dois pontos, todo ponto seria
 * trivialmente o maior ou o menor, e a afirmação não diz nada que a pessoa já
 * não veja olhando o gráfico inteiro.
 */
export function periodPointReading({
  index,
  series,
  mode,
}: {
  index: number;
  series: BarReadingPoint[];
  mode: ChartDataMode;
}): PeriodPointReading {
  const point = index >= 0 ? series[index] : undefined;
  if (!point) return EMPTY_PERIOD_READING;

  const previous = index > 0 ? series[index - 1]?.total : undefined;
  const changeFromPrevious =
    typeof previous === "number" && previous !== 0
      ? ((point.total - previous) / Math.abs(previous)) * 100
      : null;

  const average = seriesAverage(series);
  const vsAverage =
    average !== null && average !== 0 ? ((point.total - average) / Math.abs(average)) * 100 : null;

  const extremesMeaningful = series.length >= 3;
  const max = extremesMeaningful ? Math.max(...series.map((entry) => entry.total)) : null;
  const min = extremesMeaningful ? Math.min(...series.map((entry) => entry.total)) : null;

  return {
    changeFromPrevious,
    count: mode === "aggregate" && typeof point.count === "number" ? point.count : null,
    vsAverage,
    isHighest: max !== null && point.total === max,
    isLowest: min !== null && point.total === min,
  };
}
