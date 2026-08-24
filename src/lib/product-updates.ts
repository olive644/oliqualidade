export type ProductUpdate = {
  id: string;
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
};

export const APP_VERSION = "0.2.0-beta.3";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

export const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    id: "2026-08-24-acabamento-de-leitura",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Gráfico de área com legenda e valores que não se sobrepõem mais",
    summary:
      "O gráfico de área passou a identificar cada série sem precisar do mouse, e os valores escritos em cima das barras somem quando não cabem.",
    highlights: [
      "O gráfico de área ganhou legenda: resultado, referência e as variações acima e abaixo aparecem nomeados abaixo do gráfico.",
      "A referência é chamada pelo que ela é (período anterior, média móvel ou a meta escolhida), no gráfico e no detalhe ao passar o mouse.",
      "As séries também se distinguem pelo traço, e não só pela cor, o que ajuda quem tem dificuldade para diferenciar cores.",
      "Os valores escritos em cima das barras somem automaticamente quando não cabem, em vez de virar uma faixa de números sobrepostos.",
    ],
  },
  {
    id: "2026-08-24-ordem-das-categorias",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Meses, turnos e faixas deixam de sair fora de ordem",
    summary:
      "O gráfico de barras reconhece categorias que têm ordem própria e passa a respeitá-la, em vez de reordenar tudo da maior para a menor.",
    highlights: [
      "Meses, dias da semana, turnos, trimestres e semestres aparecem na ordem em que acontecem.",
      "Faixas de valor (0 a 10, 10 a 20, acima de 100) seguem a ordem numérica, e não a ordem do texto.",
      "Escalas de satisfação e de concordância vão do pior degrau para o melhor, sem embaralhar.",
      "Etapas numeradas de um processo (1. Recebimento, 2. Inspeção) mantêm a sequência.",
      "Um seletor novo de ordem permite escolher entre automática, ordem natural, maior para menor e A a Z.",
      "Rankings comuns continuam ordenados da maior barra para a menor, como antes.",
    ],
  },
  {
    id: "2026-08-24-leitura-de-graficos",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Gráficos que dizem o que está sendo medido",
    summary:
      "Cada gráfico agora informa o que está em cada eixo, marca a média entre as categorias e explica a comparação que mostra ao passar o mouse.",
    highlights: [
      "Uma linha sob o gráfico diz o que está no eixo horizontal e o que está no vertical, com a operação e a métrica por extenso.",
      "O gráfico de barras ganhou uma linha tracejada na média entre as categorias, para separar quem está acima e quem está abaixo sem fazer a conta de cabeça.",
      "Ao passar o mouse em uma barra, o gráfico mostra quantos registros sustentam aquele valor, evitando conclusão em cima de duas ou três linhas.",
      "Em ranking, a comparação passou a ser com a maior barra do gráfico, escrita por extenso, no lugar de uma variação percentual que parecia queda sem ter havido queda.",
      "A variação em relação ao período anterior continua aparecendo nos gráficos com eixo de tempo, agora identificada como tal.",
    ],
  },
  {
    id: "2026-08-24-correcoes-de-estabilidade",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Correções de estabilidade em datas, cores, fórmulas e leitura automática",
    summary:
      "Uma revisão dedicada encontrou e corrigiu problemas reais em datas, cores importadas do Excel, fórmulas entre abas, investigação guiada, o widget de mapa e o painel automático.",
    highlights: [
      "Datas em formato brasileiro (dd/mm/aaaa) são interpretadas corretamente ao comparar períodos na investigação guiada.",
      "Cores de célula originais do Excel (branco e preto) deixam de aparecer trocadas ao importar.",
      'O botão "Investigar" agora usa a métrica da pergunta que você clicou e leva direto ao painel de investigação.',
      "A contagem de pendências no topo do painel volta a bater com o que aparece filtrado na tela.",
      'O roteiro de perguntas reconhece melhor os gráficos já criados, evitando repetir "sem gráfico" indevidamente.',
      "Cores dos gráficos de área e cor condicional em histograma e Pareto voltaram a seguir a paleta e a régua configurada.",
      "Fórmulas que somam ou contam valores de outra aba da planilha (SUMIF, COUNTIF, COUNTA) são calculadas corretamente ao importar.",
      "O widget de mapa só aceita colunas com nome de local de verdade (cidade, estado, país, bairro), evitando tentar localizar dados que não são endereço.",
      "Os widgets do painel automático preenchem a grade sem deixar espaços vazios entre eles.",
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
