export type ProductUpdate = {
  id: string;
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
};

export const APP_VERSION = "0.10.0-beta.9";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

export const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    id: "2026-08-26-assistente-responde-enquanto-escreve",
    version: APP_VERSION,
    date: "2026-08-26",
    title: "O assistente passou a responder enquanto escreve",
    summary:
      "A resposta do Oli agora aparece trecho por trecho, assim que o Gemini produz cada parte, sem esperar o texto inteiro ficar pronto.",
    highlights: [
      "A geração, o servidor e a conversa usam o mesmo fluxo contínuo; nenhum dos três segura a resposta completa antes de mostrar.",
      "O indicador de análise permanece até chegar o primeiro trecho e então dá lugar ao texto que está sendo produzido.",
      "Se a conexão terminar no meio, o Oli avisa que a resposta foi interrompida em vez de apresentar um texto incompleto como concluído.",
      "Trocar de painel ou de aba cancela a resposta anterior, evitando que ela apareça no contexto errado.",
    ],
  },
  {
    id: "2026-08-26-leitor-xml-atualizado",
    version: APP_VERSION,
    date: "2026-08-26",
    title: "O leitor de planilha ganhou uma base mais nova por dentro",
    summary:
      "A biblioteca que lê o XML de dentro do arquivo do Excel foi atualizada. Ela passou a trabalhar direto com texto em vez de bytes crus, o que simplifica o caminho da leitura.",
    highlights: [
      "A conferência foi feita contra as planilhas reais de teste: 65 arquivos e mais de 223 mil células, com resultado idêntico ao de antes.",
      "A nova versão também recusa arquivo com codificação inválida em vez de deixar passar bytes estranhos em silêncio.",
      "Nada muda no que você vê. É manutenção da fundação, com a garantia de que a leitura continua a mesma.",
    ],
  },
  {
    id: "2026-08-26-orcamento-pegou-carregamento",
    version: APP_VERSION,
    date: "2026-08-26",
    title: "Uma atualização deixaria o aplicativo mais lento para abrir, e foi barrada",
    summary:
      "Uma atualização de ferramenta de construção juntaria num pacote só o que hoje é carregado conforme a necessidade. O tamanho total seria o mesmo, mas a primeira abertura ficaria bem mais pesada.",
    highlights: [
      "O pacote inicial iria de 296 KB para mais de 1 MB, e a verificação automática de desempenho recusou a mudança.",
      "Ela foi separada das outras doze atualizações do mesmo lote, que não têm nada a ver com isso e seguem normalmente.",
      "Nada muda para você agora. É a proteção funcionando antes de a lentidão chegar até a sua tela.",
    ],
  },
  {
    id: "2026-08-26-ci-na-versao-de-producao",
    version: APP_VERSION,
    date: "2026-08-26",
    title: "As verificações automáticas passaram a rodar na mesma versão do servidor real",
    summary:
      "A bateria de testes que roda antes de qualquer mudança chegar até você usava uma versão do ambiente mais antiga que a do servidor de produção. Agora é a mesma.",
    highlights: [
      "Testar numa versão e publicar em outra deixa uma faixa de comportamento que ninguém verifica.",
      "Isso também destrava as atualizações automáticas de dependência, que vinham falhando por causa dessa diferença.",
      "Nada muda no aplicativo. É a rede de proteção ficando igual ao ambiente que ela protege.",
    ],
  },
  {
    id: "2026-08-24-limite-e-verificacao",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "O limite de uso do assistente passou a valer de verdade",
    summary:
      "O controle que evita uso abusivo do assistente contava cada servidor separadamente e recomeçava do zero a cada reinício. Agora a contagem é uma só, compartilhada.",
    highlights: [
      "Na prática, o teto diário da análise inteligente era o número configurado multiplicado por quantos servidores estivessem no ar. Agora é o número configurado.",
      "Se o armazenamento compartilhado ficar fora do ar, o assistente continua funcionando com o controle anterior, em vez de parar.",
      "Entrou também uma verificação de que existe uma pessoa do outro lado, invisível na maioria das vezes: ela aparece só quando há motivo para desconfiar, e não se repete a cada pergunta.",
      "Nada disso muda o que você vê ao usar o assistente normalmente.",
    ],
  },
  {
    id: "2026-08-24-teste-de-componente",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Os widgets passaram a ser testados como a tela mostra, não só por dentro",
    summary:
      "Até agora a verificação automática cobria os cálculos, e o que aparece na tela dependia de conferência manual. Agora o widget é montado de verdade durante a verificação.",
    highlights: [
      "O primeiro caso coberto é o valor escrito em cima da barra: ele deve aparecer num painel largo e sumir na largura de um celular, onde os números se sobreporiam.",
      "A contagem de pendências passou a ser verificada junto com o filtro ativo, que é quando ela costumava divergir da lista mostrada.",
      "Nada muda no que você vê. É uma rede de proteção para que esses dois comportamentos não voltem a quebrar em silêncio.",
    ],
  },
  {
    id: "2026-08-24-analise-estatica",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Todo código passa por uma varredura de segurança antes de entrar",
    summary:
      "Cada mudança proposta ao aplicativo agora é lida por um analisador que procura padrões de código inseguro, e a mudança não entra enquanto houver achado.",
    highlights: [
      "A varredura procura coisas como conteúdo de origem externa injetado direto na tela e link para destino não confiável.",
      "Isso substitui a análise que o GitHub oferecia enquanto o projeto era público e que deixou de ser gratuita quando ele passou a ser privado.",
      "Não muda nada no que você vê ou faz no aplicativo. É uma checagem que roda antes de qualquer coisa chegar até você.",
    ],
  },
  {
    id: "2026-08-24-retencao-de-caches",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "O que fica guardado agora tem prazo de validade",
    summary:
      "Os dados que o aplicativo guarda no navegador passaram a ter limite de idade, além do limite de quantidade que já existia.",
    highlights: [
      "O cache de localizações do mapa guardava coordenadas para sempre, inclusive de planilhas que você não tem mais. Agora expira em 180 dias.",
      "O histórico de desempenho das importações guarda 90 dias.",
      "O histórico de versões dos painéis guarda um ano, e as versões que você marcou nunca são descartadas.",
      "Os prazos ficam em um só lugar do código, então a central de privacidade mostra exatamente o que o aplicativo faz.",
    ],
  },
  {
    id: "2026-08-24-arquivo-pelo-conteudo",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "O arquivo passa a ser reconhecido pelo conteúdo, não pela extensão",
    summary:
      "A importação agora olha os primeiros bytes do arquivo. Isso recusa o que não é planilha com uma explicação, e aceita o que é planilha mesmo com o nome trocado.",
    highlights: [
      'Enviar um PDF com nome de planilha agora responde "este arquivo é um PDF, não uma planilha", em vez de falhar com erro genérico.',
      "Uma planilha antiga renomeada para .xlsx passa a ser lida normalmente, em vez de quebrar na leitura.",
      "Tabelas HTML exportadas com nome .xls, comuns em sistemas corporativos, continuam funcionando.",
      "A verificação de integridade do pacote passou a valer também para ODS, Numbers e XLSB, que antes ficavam de fora.",
    ],
  },
  {
    id: "2026-08-24-leitura-de-texto-do-xml",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Leitura de texto da planilha ficou mais resistente a arquivo malformado",
    summary:
      "A extração de texto do arquivo do Excel passou a repetir a limpeza da marcação até estabilizar, em vez de uma passada só.",
    highlights: [
      "Em arquivos com marcação quebrada, uma limpeza única podia juntar pedaços e deixar sobra de marcação no texto lido.",
      "Textos que a planilha guarda escapados, como uma célula que contém literalmente <b>, continuam sendo lidos exatamente como foram escritos.",
    ],
  },
  {
    id: "2026-08-24-historico-do-painel",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Histórico do painel: volte a como estava semana passada",
    summary:
      "O painel passa a guardar como esteve montado ao longo do tempo, com o que mudou em cada ponto, e isso sobrevive a fechar o aplicativo.",
    highlights: [
      "Cada alteração relevante vira uma versão, com uma frase dizendo o que mudou: widgets a mais, filtro a menos, colunas alteradas.",
      'O botão "Guardar como está agora" marca uma versão que nunca é descartada pela limpeza automática.',
      "Restaurar traz de volta widgets, filtros e colunas visíveis. As linhas da planilha não mudam.",
      "O histórico é do arranjo do painel, não dos dados: por isso ocupa poucos quilobytes e não ressuscita dado antigo.",
      "No modo privado nada é gravado, e a central de privacidade mostra quanto o histórico ocupa.",
    ],
  },
  {
    id: "2026-08-24-modelos-por-finalidade",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Modelos por finalidade: vendas, financeiro, qualidade e estudos",
    summary:
      "Na revisão da importação dá para dizer para que serve a planilha, e o painel passa a mostrar primeiro o que aquele tipo de análise lê primeiro.",
    highlights: [
      "Quatro finalidades disponíveis: vendas, financeiro, qualidade e estudos.",
      "O OliQualidade sugere a finalidade pelos nomes das colunas, mas quem escolhe é você.",
      "A finalidade muda a ordem dos gráficos, e não os cálculos: os mesmos números, na ordem em que aquela análise costuma ser lida.",
      "Os indicadores continuam no topo e a tabela detalhada no fim, independentemente da finalidade.",
      "Sem finalidade declarada, o painel é montado como sempre foi.",
    ],
  },
  {
    id: "2026-08-24-central-de-privacidade",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Central de privacidade: veja o que fica guardado e o que sai daqui",
    summary:
      "Uma tela nova mostra quanto cada coisa ocupa neste navegador, permite limpar por categoria e exibe exatamente o que seria enviado ao assistente.",
    highlights: [
      "O tamanho real de cada categoria guardada, separando seus painéis do cache que o aplicativo refaz sozinho.",
      "Botão de limpar por categoria, com aviso em quem apaga trabalho de verdade.",
      "Quanto espaço o navegador reservou para o aplicativo e quanto já está em uso.",
      "O conteúdo exato que seria enviado ao assistente, montado na hora pela mesma função que monta o envio real.",
      'Acesso pela paleta de comandos, buscando por "privacidade".',
    ],
  },
  {
    id: "2026-08-24-meta-nao-e-resultado",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Painel automático deixa de montar tudo em cima da coluna de meta",
    summary:
      "Colunas como meta, alvo e limite dizem onde o resultado deveria chegar. O painel passou a tratá-las como referência, e não como o resultado em si.",
    highlights: [
      "O gráfico de evolução mostrava a meta ao longo do tempo, que é uma linha reta comparada com ela mesma, e parecia um gráfico sem dados.",
      "Agora ele mostra o resultado, com a meta desenhada como linha de referência e as faixas de quanto ficou acima ou abaixo dela.",
      "A correção vale para o painel inteiro: indicadores, comparações por categoria e radar passaram a se apoiar no resultado.",
      "Sem coluna de meta na planilha, o gráfico continua comparando com o período anterior, como antes.",
    ],
  },
  {
    id: "2026-08-24-busca-global",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Busca global: ache coluna, widget, aba ou painel pelo nome",
    summary:
      "A paleta de comandos deixou de listar só ações e passou a encontrar o que existe no painel.",
    highlights: [
      "Digite o nome de uma coluna, widget, aba ou painel e vá direto até ele.",
      "Escolher um widget rola a tela até ele; escolher uma coluna já cria o filtro dela.",
      "Colunas numéricas aparecem também como métrica, para virar um indicador em um passo.",
      "Widgets são encontrados também pelas colunas que usam, mesmo que o nome deles não diga isso.",
    ],
  },
  {
    id: "2026-08-24-barra-mobile",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Barra de navegação no rodapé do celular",
    summary:
      "As ações principais do painel passam a ficar fixas na parte de baixo da tela, ao alcance do polegar.",
    highlights: [
      "Painéis, buscar, filtrar, acrescentar widget e visão geral em uma barra fixa no rodapé.",
      "Antes, filtrar e acrescentar widget ficavam fora da tela até alguém arrastar a barra de ferramentas para o lado.",
      "A barra respeita a área segura do aparelho e só aparece na largura de celular.",
      "No modo leitura, o botão de acrescentar widget some da barra, como o resto das ferramentas de montagem.",
    ],
  },
  {
    id: "2026-08-24-modo-leitura",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Modo leitura: o painel sem as ferramentas de montagem",
    summary:
      "Um botão novo na barra alterna entre ler e editar. No modo leitura, o painel fica só com a análise.",
    highlights: [
      "As alças de arrastar, os botões de remover e copiar widget e a barra de configuração somem da tela.",
      "Acrescentar widget, colar, colunas, formatação e combinar planilha saem da barra superior.",
      "Filtrar, qualidade dos dados, marcadores, apresentação e exportar continuam disponíveis: são leitura, não montagem.",
      "O modo escolhido fica salvo neste navegador e continua valendo ao voltar.",
    ],
  },
  {
    id: "2026-08-24-filtro-alcance",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "O painel diz quantos widgets um filtro alcançou",
    summary:
      "Ao filtrar, o contexto da análise passa a informar quantos widgets foram recalculados, além de quantas linhas sobraram.",
    highlights: [
      'Com um filtro ativo, o topo do painel mostra "12 de 12 widgets atualizados".',
      "O filtro sempre valeu para o painel inteiro; o que faltava era dizer isso, para ninguém precisar conferir widget por widget.",
      "Widgets que não leem as linhas da planilha, como uma imagem embutida ou a lista de planilhas monitoradas, ficam de fora da conta.",
    ],
  },
  {
    id: "2026-08-24-hierarquia-dos-widgets",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "O resultado vem primeiro em todos os widgets",
    summary:
      "Os sete campos técnicos que ficavam entre o título e o número desceram para o pé do widget, e a maior parte deles agora abre só quando você pede.",
    highlights: [
      "Todo widget passou a seguir a mesma ordem de leitura: resultado, visualização, explicação, evidências e configuração técnica.",
      "No pé do widget ficam visíveis apenas os dois dados necessários para confiar no número: quantos registros sustentam a conta e quantos filtros estão ativos.",
      'Fonte, cálculo, unidade, confiança e fórmula continuam a um clique de distância, no botão "Ver cálculo".',
      "O painel exportado continua trazendo o cálculo completo, porque ali ele circula sem ninguém por perto para clicar.",
    ],
  },
  {
    id: "2026-08-24-widgets-adaptaveis",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Cada widget passa a se ajustar ao espaço que ele tem",
    summary:
      "Antes os widgets reagiam ao tamanho da tela. Agora cada um reage à própria largura dentro do painel, que é o que de fato decide o que cabe.",
    highlights: [
      "Gráficos ganham altura quando o widget é largo e ficam mais baixos quando o widget é estreito, mesmo sem mudar o tamanho da janela.",
      "Os valores em cima das barras e os nomes das categorias passaram a ser decididos pela largura medida do gráfico, e não por uma estimativa.",
      "Em telas largas, um widget de um terço agora mostra todos os nomes das categorias, que antes eram cortados sem necessidade.",
      "Três modos de densidade (compacto, normal e expandido) passaram a ser um conceito único do produto, usado tanto pelo layout quanto pelas decisões de conteúdo.",
    ],
  },
  {
    id: "2026-08-24-blocos-unificados",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Planilhas feitas de vários blocos viram uma tabela analisável",
    summary:
      "Modelos como o de orçamento pessoal são montados com várias tabelas do Excel, uma por categoria. Agora dá para lê-las como uma tabela só, com o nome do bloco virando coluna.",
    highlights: [
      'A importação oferece uma opção nova, "Blocos unificados", quando a aba é formada por blocos com a mesma estrutura.',
      "O nome de cada bloco (Moradia, Transporte, Alimentação) vira uma coluna, então dá para agrupar, filtrar e comparar por bloco.",
      "As linhas de cabeçalho e de total de cada bloco ficam de fora, sem inflar nenhuma conta.",
      "A leitura da aba inteira continua disponível como segunda opção, para quem preferir o formato original.",
    ],
  },
  {
    id: "2026-08-24-linhas-de-total",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Linhas de total da planilha não entram mais em dobro nas contas",
    summary:
      "Planilhas montadas com tabelas do Excel, como os modelos de orçamento e de controle, têm uma linha de total em cada bloco. Essas linhas deixam de virar registros.",
    highlights: [
      "O OliQualidade lê a definição das tabelas do próprio arquivo para saber quais linhas são totais, em vez de adivinhar pelo texto.",
      "Em um orçamento pessoal real, a soma das despesas passou de R$ 4.120 para os R$ 2.060 que a própria planilha mostra.",
      "Em planilhas com blocos lado a lado, só as colunas do bloco que declarou o total são ignoradas, preservando os dados do bloco vizinho na mesma linha.",
      "A revisão de importação avisa quantas linhas de total ficaram de fora e por quê.",
    ],
  },
  {
    id: "2026-08-24-acabamento-de-leitura",
    version: APP_VERSION,
    date: "2026-08-24",
    title: "Gráfico de área com legenda e valores que não se sobrepõem mais",
    summary:
      "O gráfico de área passou a identificar cada série sem precisar do mouse, e os valores escritos em cima das barras somem quando não cabem.",
    highlights: [
      "A legenda do gráfico de área passou a incluir a linha de referência, que antes só aparecia ao passar o mouse.",
      "A referência é chamada pelo que ela é (período anterior, média móvel ou a meta escolhida), no gráfico e no detalhe ao passar o mouse.",
      "As séries também se distinguem pelo traço, e não só pela cor, o que ajuda quem tem dificuldade para diferenciar cores.",
      "Os valores escritos em cima das barras somem automaticamente quando não cabem, em vez de virar uma faixa de números sobrepostos.",
      "Os nomes das categorias no eixo do gráfico deixam de se sobrepor em cartões estreitos: o gráfico mostra menos nomes, inteiros, e o nome completo continua ao passar o mouse.",
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
