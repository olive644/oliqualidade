/**
 * Escolha do caminho de importação, num lugar só.
 *
 * O leitor atual monta o arquivo inteiro em memória e, a partir dele, um
 * workbook do SheetJS. O baseline medido em `scripts/benchmark-import-baseline.mjs`
 * mostra que o conjunto vivo fica entre 5,8 e 6,5 vezes o tamanho do arquivo,
 * e que a parte que domina não é o ZIP expandido (cerca de 1x) e sim o workbook
 * (cerca de 3,5x). Um arquivo de 65 MiB já pede 430 MiB.
 *
 * É esse número que este módulo aplica: enquanto o pico previsto couber com
 * folga, o caminho atual continua sendo o melhor, porque é o validado pelo
 * corpus e por toda a suíte. Acima disso, a decisão passa a valer a pena.
 *
 * Nenhum limite numérico deve ser escrito fora daqui. Espalhar esses números
 * pelo código foi exatamente o que fez a proteção de prazo do assistente
 * proteger só até os cabeçalhos sem ninguém notar.
 */

const MIB = 1024 * 1024;

/**
 * Quantas vezes o tamanho do arquivo o conjunto vivo ocupa no caminho atual.
 *
 * Não é estimativa de projeto: é a razão medida nos quatro cenários do
 * baseline (6,1x, 5,8x, 6,5x e 5,8x). O valor conservador de 6 é usado para
 * prever o pico antes de ler o arquivo, quando a única coisa conhecida é o
 * tamanho em bytes.
 */
export const IMPORT_PEAK_MEMORY_RATIO = 6;

/**
 * Pico previsto que ainda é confortável num computador comum.
 *
 * 200 MiB corresponde a cerca de 33 MiB de arquivo. Acima disso o baseline
 * mostra a curva ficando desagradável mesmo em máquina de desenvolvimento.
 */
export const IMPORT_COMFORTABLE_PEAK_BYTES = 200 * MIB;

/**
 * O mesmo, para aparelho modesto.
 *
 * Uma aba de navegador em celular de 2 a 4 GB costuma ser encerrada bem antes
 * de meio giga. 48 MiB de pico corresponde a cerca de 8 MiB de arquivo, que é
 * o ponto onde vale trocar de estratégia em vez de arriscar a aba morrer no
 * meio da importação.
 */
export const IMPORT_COMFORTABLE_PEAK_BYTES_CONSTRAINED = 48 * MIB;

/** Formatos que o caminho progressivo pode vir a atender, por família. */
const CSV_EXTENSIONS = /\.(csv|txt|tsv)$/i;
const OOXML_EXTENSIONS = /\.(xlsx|xlsm|xltx|xltm)$/i;

export type ImportStrategy = "atual" | "csv-progressivo" | "ooxml-progressivo";

export type ImportStrategyReason =
  | "pico-confortavel"
  | "pico-alto"
  | "pico-alto-em-aparelho-modesto"
  | "formato-sem-caminho-progressivo"
  | "caminho-progressivo-indisponivel";

/**
 * O que já existe de fato.
 *
 * O seletor é entregue antes das implementações progressivas de propósito, para
 * que a decisão e os limites possam ser revisados e testados sozinhos. Enquanto
 * uma família estiver desligada aqui, a escolha cai no caminho atual, que é o
 * comportamento seguro e o único validado pelo corpus.
 */
export type ImportProgressiveSupport = { csv?: boolean; ooxml?: boolean };

export type ImportStrategyInput = {
  fileName: string;
  bytes: number;
  /** Aparelho tratado como modesto. Ver `isConstrainedDevice`. */
  constrained?: boolean;
  support?: ImportProgressiveSupport;
};

export type ImportStrategyDecision = {
  /** O caminho que será realmente usado. */
  strategy: ImportStrategy;
  /** O que seria escolhido se a implementação já existisse. */
  preferred: ImportStrategy;
  reason: ImportStrategyReason;
  /** Pico previsto para o caminho atual, em bytes. */
  estimatedPeakBytes: number;
  /** Teto de conforto aplicado, já considerando o aparelho. */
  comfortablePeakBytes: number;
};

export function estimateCurrentPathPeakBytes(bytes: number): number {
  return Math.max(0, bytes) * IMPORT_PEAK_MEMORY_RATIO;
}

function preferredStrategyFor(fileName: string): ImportStrategy | null {
  if (CSV_EXTENSIONS.test(fileName)) return "csv-progressivo";
  if (OOXML_EXTENSIONS.test(fileName)) return "ooxml-progressivo";
  return null;
}

function isSupported(strategy: ImportStrategy, support: ImportProgressiveSupport): boolean {
  if (strategy === "csv-progressivo") return support.csv === true;
  if (strategy === "ooxml-progressivo") return support.ooxml === true;
  return true;
}

/**
 * Decide o caminho, e diz por quê.
 *
 * A decisão é uma função pura de tamanho, nome e ambiente. Nada aqui lê o
 * arquivo, toca no navegador ou depende de estado global, para que a mesma
 * decisão possa ser reproduzida num teste com um número.
 */
export function chooseImportStrategy(input: ImportStrategyInput): ImportStrategyDecision {
  const support = input.support ?? {};
  const comfortablePeakBytes = input.constrained
    ? IMPORT_COMFORTABLE_PEAK_BYTES_CONSTRAINED
    : IMPORT_COMFORTABLE_PEAK_BYTES;
  const estimatedPeakBytes = estimateCurrentPathPeakBytes(input.bytes);
  const preferredProgressive = preferredStrategyFor(input.fileName);

  // Cabe com folga: o caminho atual é o validado pelo corpus e por toda a
  // suíte, então ele continua sendo a melhor escolha, não a escolha herdada.
  if (estimatedPeakBytes <= comfortablePeakBytes)
    return {
      strategy: "atual",
      preferred: "atual",
      reason: "pico-confortavel",
      estimatedPeakBytes,
      comfortablePeakBytes,
    };

  // Passou do conforto, mas o formato não tem caminho progressivo possível.
  // Segue no atual, e quem chama pode avisar que vai demorar.
  if (!preferredProgressive)
    return {
      strategy: "atual",
      preferred: "atual",
      reason: "formato-sem-caminho-progressivo",
      estimatedPeakBytes,
      comfortablePeakBytes,
    };

  // O formato tem caminho progressivo, mas ele ainda não existe. Cair no atual
  // é o comportamento seguro; o motivo distingue "não vale a pena" de "ainda
  // não implementado", que são coisas diferentes para quem lê a telemetria.
  if (!isSupported(preferredProgressive, support))
    return {
      strategy: "atual",
      preferred: preferredProgressive,
      reason: "caminho-progressivo-indisponivel",
      estimatedPeakBytes,
      comfortablePeakBytes,
    };

  return {
    strategy: preferredProgressive,
    preferred: preferredProgressive,
    reason: input.constrained ? "pico-alto-em-aparelho-modesto" : "pico-alto",
    estimatedPeakBytes,
    comfortablePeakBytes,
  };
}

/**
 * Sinais de aparelho modesto, sem depender de uma API só.
 *
 * `deviceMemory` não existe no Safari nem no Firefox, então usá-la sozinha
 * classificaria todo iPhone como máquina folgada, que é o erro mais caro
 * possível aqui. A leitura combina três sinais fracos e trata qualquer um deles
 * como suficiente, porque o custo de errar para o lado cauteloso é uma
 * importação mais lenta, e o de errar para o outro lado é a aba morrer.
 */
export function isConstrainedDevice(
  source: {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    userAgent?: string;
  } = {},
): boolean {
  if (typeof source.deviceMemory === "number" && source.deviceMemory <= 4) return true;
  if (typeof source.hardwareConcurrency === "number" && source.hardwareConcurrency <= 4)
    return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(source.userAgent ?? "");
}
