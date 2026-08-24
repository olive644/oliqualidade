/**
 * Reconhece categorias que têm ordem própria.
 *
 * O gráfico de barras ordena da maior para a menor, o que é a leitura certa
 * para um ranking ("quem vendeu mais") e a leitura errada para uma sequência
 * ("como o resultado se distribui por mês"). Meses, dias da semana, turnos,
 * faixas de valor e escalas de satisfação já vêm com uma ordem embutida: ao
 * reordená-los por tamanho, o gráfico embaralha justamente a informação que
 * o leitor usaria para enxergar progressão, sazonalidade ou concentração em
 * uma ponta da escala.
 *
 * A detecção é deliberadamente conservadora. Exige que **todas** as
 * categorias pertençam à mesma escala e que haja pelo menos três delas —
 * duas categorias não formam sequência reconhecível, e uma escala com
 * sobras significa que o vocabulário não era o que parecia. Na dúvida, o
 * gráfico continua ordenando por valor, que é o comportamento anterior.
 */

/** Sinônimos e abreviações aceitos para cada degrau, em ordem. */
type OrdinalScale = string[][];

const MONTHS: OrdinalScale = [
  ["janeiro", "jan"],
  ["fevereiro", "fev"],
  ["marco", "mar"],
  ["abril", "abr"],
  ["maio", "mai"],
  ["junho", "jun"],
  ["julho", "jul"],
  ["agosto", "ago"],
  ["setembro", "set"],
  ["outubro", "out"],
  ["novembro", "nov"],
  ["dezembro", "dez"],
];

const WEEKDAYS: OrdinalScale = [
  ["domingo", "dom"],
  ["segunda", "segunda-feira", "seg"],
  ["terca", "terca-feira", "ter"],
  ["quarta", "quarta-feira", "qua"],
  ["quinta", "quinta-feira", "qui"],
  ["sexta", "sexta-feira", "sex"],
  ["sabado", "sab"],
];

const SHIFTS: OrdinalScale = [["madrugada"], ["manha"], ["tarde"], ["noite"]];

const QUARTERS: OrdinalScale = [
  ["1 trimestre", "primeiro trimestre", "t1", "q1"],
  ["2 trimestre", "segundo trimestre", "t2", "q2"],
  ["3 trimestre", "terceiro trimestre", "t3", "q3"],
  ["4 trimestre", "quarto trimestre", "t4", "q4"],
];

const SEMESTERS: OrdinalScale = [
  ["1 semestre", "primeiro semestre", "s1"],
  ["2 semestre", "segundo semestre", "s2"],
];

const SATISFACTION: OrdinalScale = [
  ["pessimo", "muito ruim"],
  ["ruim"],
  ["regular", "neutro", "razoavel"],
  ["bom"],
  ["otimo", "excelente", "muito bom"],
];

const AGREEMENT: OrdinalScale = [
  ["discordo totalmente", "discordo plenamente"],
  ["discordo"],
  ["neutro", "indiferente", "nem concordo nem discordo"],
  ["concordo"],
  ["concordo totalmente", "concordo plenamente"],
];

const INTENSITY: OrdinalScale = [
  ["muito baixo", "muito baixa"],
  ["baixo", "baixa"],
  ["medio", "media", "moderado", "moderada"],
  ["alto", "alta"],
  ["muito alto", "muito alta", "critico", "critica"],
];

const SIZES: OrdinalScale = [
  ["pp"],
  ["p", "pequeno", "pequena"],
  ["m", "medio", "media"],
  ["g", "grande"],
  ["gg", "xg", "extra grande"],
];

const SCALES: OrdinalScale[] = [
  MONTHS,
  WEEKDAYS,
  SHIFTS,
  QUARTERS,
  SEMESTERS,
  SATISFACTION,
  AGREEMENT,
  INTENSITY,
  SIZES,
];

/** Mínimo de categorias para considerar que existe uma sequência. */
const MIN_ORDINAL_CATEGORIES = 3;

/**
 * Tira acento, caixa, marcador ordinal (º/ª) e espaço repetido, preservando
 * a pontuação — é a forma usada para ler números, onde o ponto de milhar e a
 * vírgula decimal ainda importam.
 */
function deburr(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[ºª°]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Forma de comparação de vocabulário: além de `deburr`, remove a pontuação
 * que não distingue degraus, para que "1º Trimestre", "1o. trimestre" e
 * "primeiro trimestre" caiam no mesmo lugar.
 */
function normalize(label: string): string {
  return deburr(label)
    .replace(/[.,;:!?/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankInScale(label: string, scale: OrdinalScale): number | null {
  const normalized = normalize(label);
  for (let rank = 0; rank < scale.length; rank++) {
    if (scale[rank]?.some((term) => term === normalized)) return rank;
  }
  return null;
}

/**
 * Primeiro número de um rótulo de faixa ou etapa, usado para ordenar coisas
 * como "0 a 10", "10-20", "acima de 100", "R$ 1.000 a R$ 2.000" e
 * "1. Recebimento". Aceita vírgula decimal e ponto de milhar brasileiros.
 *
 * "até 5" não tem número inicial e mesmo assim precisa vir antes de "5 a
 * 10": um limite superior sem piso é o começo da escala, então vale
 * `-Infinity`.
 */
export function leadingNumberOf(label: string): number | null {
  // Sem a limpeza de pontuação de `normalize`: ela separa "1.500,50" em
  // "1 500,50", e o primeiro número do rótulo passaria a ser 1.
  const normalized = deburr(label);
  if (/^(ate|abaixo de|menos de|menor que)\b/.test(normalized)) return Number.NEGATIVE_INFINITY;
  const match = normalized.match(/-?\d[\d.]*(,\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Devolve a posição de cada categoria na sua ordem natural, ou `null` quando
 * as categorias não formam nenhuma sequência reconhecível.
 */
export function ordinalRanks(names: string[]): Map<string, number> | null {
  const distinct = [...new Set(names)];
  if (distinct.length < MIN_ORDINAL_CATEGORIES) return null;

  for (const scale of SCALES) {
    const ranked = distinct.map((name) => [name, rankInScale(name, scale)] as const);
    if (ranked.every(([, rank]) => rank !== null)) {
      // Duas categorias no mesmo degrau significam vocabulário ambíguo
      // (ex.: "Média" cabe em intensidade e em tamanho): sem ordem única,
      // não há sequência a preservar.
      const ranks = ranked.map(([, rank]) => rank);
      if (new Set(ranks).size === ranks.length) {
        return new Map(ranked.map(([name, rank]) => [name, rank as number]));
      }
    }
  }

  const numbered = distinct.map((name) => [name, leadingNumberOf(name)] as const);
  if (numbered.every(([, value]) => value !== null)) {
    const ordered = [...numbered].sort((a, b) => (a[1] as number) - (b[1] as number));
    return new Map(ordered.map(([name], index) => [name, index]));
  }

  return null;
}
