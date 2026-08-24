export type ProductUpdate = {
  id: string;
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
};

export const APP_VERSION = "0.1.0-beta.2";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

export const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    id: "2026-08-24-correcoes-de-estabilidade",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Correções de estabilidade em datas, cores e leitura automática",
    summary:
      "Uma revisão dedicada encontrou e corrigiu problemas reais em datas, cores importadas do Excel, investigação guiada e no roteiro de perguntas.",
    highlights: [
      "Datas em formato brasileiro (dd/mm/aaaa) são interpretadas corretamente ao comparar períodos na investigação guiada.",
      "Cores de célula originais do Excel (branco e preto) deixam de aparecer trocadas ao importar.",
      'O botão "Investigar" agora usa a métrica da pergunta que você clicou, não sempre a mesma.',
      "A contagem de pendências no topo do painel volta a bater com o que aparece filtrado na tela.",
      'O roteiro de perguntas reconhece melhor os gráficos já criados, evitando repetir "sem gráfico" indevidamente.',
      "Cores dos gráficos de área e cor condicional em histograma e Pareto voltaram a seguir a paleta e a régua configurada.",
    ],
  },
  {
    id: "2026-08-23-investigacao-guiada",
    version: APP_VERSION,
    date: "2026-08-23",
    title: "Investigação guiada para entender o resultado",
    summary:
      "As perguntas analíticas agora conectam a leitura do gráfico às causas e aos registros usados.",
    highlights: [
      "Compare os dois períodos mais recentes sem sair da visão geral.",
      "Veja as categorias que mais aumentaram ou reduziram o resultado.",
      "Confira os registros usados na explicação antes de tomar uma decisão.",
      "Continue a análise em um gráfico de Pareto ou de barras.",
    ],
  },
  {
    id: "2026-08-23-area-analitica",
    version: APP_VERSION,
    date: "2026-08-23",
    title: "Gráfico de área com leitura mais clara",
    summary:
      "A evolução temporal separa o resultado observado, os valores acima da referência e os valores abaixo da referência.",
    highlights: [
      "Três séries identificadas por legenda e detalhes ao passar o mouse.",
      "Datas extremas preservadas sem cortar o ano.",
      "Cores ciano, verde e âmbar, sem usar vermelho na leitura.",
    ],
  },
  {
    id: "2026-08-23-roteiro-analitico",
    version: APP_VERSION,
    date: "2026-08-23",
    title: "Roteiro analítico reorganizado",
    summary:
      "A visão geral passou a orientar perguntas, respostas e próximos passos de forma mais conectada.",
    highlights: [
      "Perguntas cobertas apontam diretamente para o gráfico responsável pela resposta.",
      "Perguntas ainda não cobertas sugerem o widget mais adequado.",
      "Filtros ativos continuam visíveis no contexto da análise.",
    ],
  },
];

export const CURRENT_UPDATE_ID = APP_VERSION;
export const UPDATE_READ_STORAGE_KEY = "oliam-last-read-update";

export function hasUnreadProductUpdate(lastReadId: string | null) {
  return lastReadId !== CURRENT_UPDATE_ID;
}
