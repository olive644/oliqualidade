# Arquitetura de leitura de planilha

Este documento descreve o caminho de importação como ele é hoje, onde estão as
cópias grandes de memória, e o contrato que a leitura progressiva vai usar. Ele
existe porque a decisão de reescrever um leitor precisa vir de medida, e não de
intuição sobre onde o custo está.

## Vocabulário

Estes nomes são usados com rigor no código e nos registros:

| Nome | O que significa |
| --- | --- |
| **Caminho atual** | O leitor validado hoje: arquivo inteiro em memória, ZIP expandido, workbook do SheetJS materializado |
| **Leitura progressiva** | Trabalho feito por partes (aba a aba, bloco a bloco) com memória limitada, mas ainda com o arquivo inteiro em memória |
| **Importação em blocos** | A entrega das linhas em lotes, com backpressure |
| **Streaming de CSV** | Streaming de verdade: `Blob.stream()`, decodificação incremental, memória limitada |
| **Streaming verdadeiro** | Reservado. Só vale quando o arquivo **não** está inteiro num `ArrayBuffer`, o ZIP **não** é expandido em memória e o resultado **não** existe em duas camadas ao mesmo tempo |

Enquanto qualquer uma das condições acima continuar valendo, o texto correto é
leitura progressiva. Chamar de streaming o que carrega o arquivo inteiro é
descrever a intenção, não o programa.

## Caminho completo hoje

```text
seleção do arquivo (Empty / import-workbench)
  → file.size verificado contra MAX_WORKBOOK_BYTES (100 MB)
  → file.arrayBuffer()                     [cópia 1: arquivo inteiro]
  → postMessage(bytes, [bytes])            transferível, sem cópia
  → worker: readWorkbookBytesWithEngine
      → checkWorkbookContent               assinatura, sem cópia
      → validateZipWorkbook                lê o EOCD e o diretório central, sem descompactar
      → unzipSync                          [cópia 2: ZIP expandido]
      → XLSX.read                          [cópia 3: workbook do SheetJS]
      → inspectOoxml + compareAndRepair    inventário independente, por aba
      → streamSheetsWithData               [cópia 4: linhas normalizadas]
      → adaptador Rust/WASM (modo candidato para xlsx)
  → postMessage por aba                    escoamento, uma cópia a menos
  → revisão → armazenamento → painel
```

## Mapa de cópias, medido

Números de `npm run benchmark:import` (Node 24, fixtures sintéticas
determinísticas, heap somado à memória externa, com `--expose-gc`):

| Cenário | Arquivo | ZIP expandido | `XLSX.read` | Linhas | Soma viva | Razão |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 mil linhas | 3,3 MiB | 3,3 | 12,0 | 1,4 | 20,1 | 6,1x |
| 100 mil linhas | 33,9 MiB | 33,8 | 114,3 | 13,9 | 195,7 | 5,8x |
| 500 mil linhas (3 colunas) | 65,7 MiB | 65,8 | 267,7 | 31,1 | 430,4 | 6,5x |
| 12 abas x 15 mil | 59,9 MiB | 59,7 | 203,3 | 25,3 | 348,1 | 5,8x |

**A conclusão que decide a arquitetura:** o pico não é o ZIP. O ZIP expandido
custa cerca de **1x** o arquivo; o workbook do SheetJS custa cerca de **3,5x**.
Acesso progressivo ao ZIP elimina a cópia menor. A cópia que domina só
desaparece se o workbook deixar de ser materializado, o que significa o caminho
Rust/WASM ou um leitor que produza linhas sem construir o workbook antes.

Um arquivo de 65 MiB já pede 430 MiB. O teto de 100 MB do produto implica um
pico da ordem de 600 MiB, que é mais do que uma aba de celular costuma
sobreviver.

### O que ainda não foi medido

- O clone estrutural do worker para a aba. Depois do escoamento por aba, ele
  deixou de manter o conjunto inteiro dos dois lados, mas o pico exato no
  navegador não foi medido aqui, porque o benchmark roda em Node.
- A retenção depois da criação do painel, e o efeito de duas importações
  seguidas. É o próximo alvo de medição.
- A cópia de bytes na entrada do WASM e o JSON de inventário na saída.

## Seletor de estratégia

`src/lib/import-strategy.ts` é o único lugar onde limites numéricos de
importação podem existir. Ele é uma função pura de tamanho, nome e ambiente:
não lê o arquivo, não toca no navegador, não depende de estado global.

| Constante | Valor | Origem |
| --- | ---: | --- |
| `IMPORT_PEAK_MEMORY_RATIO` | 6 | Razão medida (6,1x, 5,8x, 6,5x, 5,8x), arredondada para o lado conservador |
| `IMPORT_COMFORTABLE_PEAK_BYTES` | 200 MiB | Cerca de 33 MiB de arquivo |
| `IMPORT_COMFORTABLE_PEAK_BYTES_CONSTRAINED` | 48 MiB | Cerca de 8 MiB de arquivo, para aparelho modesto |

A decisão devolve `strategy` (o que será usado), `preferred` (o que seria usado
se existisse) e `reason`. A distinção entre "não vale a pena trocar" e "o
caminho progressivo ainda não existe" importa para quem lê a telemetria.

O sinal de aparelho modesto (`isConstrainedDevice`) combina `deviceMemory`,
`hardwareConcurrency` e o user agent, e trata qualquer um deles como suficiente.
`deviceMemory` não existe no Safari nem no Firefox: usá-la sozinha classificaria
todo iPhone como máquina folgada, que é o erro mais caro possível aqui. Errar
para o lado cauteloso custa uma importação mais lenta; errar para o outro lado
mata a aba.

## Contrato progressivo

`src/lib/progressive-import.ts` traz só tipos, constantes e comparadores.
Nenhuma implementação de leitor mora ali.

- **Etapas** (`ProgressiveImportStage`): validando arquivo, lendo estrutura,
  preparando textos e formatos, processando aba, analisando linhas,
  consolidando, salvando, criando painel. Cada uma corresponde a trabalho
  observável. Etapa que não sabe medir reporta `total` ausente, e a interface
  usa estado indeterminado em vez de progresso falso.
- **Blocos** (`ProgressiveRowBlock`): a unidade de entrega é o bloco, nunca a
  linha. Ordem garantida dentro da aba, com marca de último bloco.
- **Backpressure** (`ProgressiveBlockAck`, `PROGRESSIVE_MAX_PENDING_BLOCKS`):
  confirmação por bloco, com teto de dois pendentes. Sem confirmação a fila
  viraria uma segunda cópia da planilha.
- **Tamanho de bloco**: `PROGRESSIVE_BLOCK_SIZE_CANDIDATES` guarda 1.000, 2.000
  e 5.000. Nenhum foi escolhido: a decisão sai de medição na PR do CSV.
- **Cancelamento**: todo progresso e todo bloco carregam `runId`. Mensagem de
  execução antiga é descartada em vez de aplicada.
- **Equivalência**: `describeImportedSheetsDifferences` diz **onde** dois
  resultados divergem (aba, linha, coluna) sem colocar valor de célula na
  descrição, porque esse relatório pode acabar num log.

## Estado por formato

| Formato | Hoje | Planejado |
| --- | --- | --- |
| CSV, TXT, TSV | Caminho atual | `csv-stream.ts` já implementa streaming real com `Blob.stream()`, provado equivalente à análise do SheetJS; falta o coordenador que o liga à normalização |
| XLSX, XLSM, XLTX, XLTM | Caminho atual | Leitura progressiva com acesso ao ZIP por entrada |
| ODS e demais | Caminho atual | Sem plano de caminho progressivo |

Nesta etapa **nenhum caminho progressivo está ligado**. O seletor decide e
registra, e a escolha cai sempre no caminho atual com motivo
`caminho-progressivo-indisponivel`. Isso é deliberado: os limites e a decisão
podem ser revisados e testados antes de existir código de leitor novo.

## O que já existe e ajuda

`validateZipWorkbook` já localiza o EOCD e percorre o diretório central do ZIP
**sem descompactar nada**, aplicando os limites de entradas, tamanho expandido e
razão de compressão. Os dois primeiros passos de um acesso progressivo ao ZIP
estão prontos; o que falta é operá-los sobre `Blob.slice()` em vez de sobre um
`Uint8Array` já completo.

## Benchmarks

```bash
npm run benchmark:import            # cenários completos
node --expose-gc scripts/benchmark-import-baseline.mjs --quick
```

Sem `--expose-gc` o script avisa e os tempos continuam válidos, mas as medidas
de memória viram ordem de grandeza. As fixtures são geradas na hora, são
determinísticas e nada é versionado. O relatório sai em
`test-results/import-baseline.json`.

Duas armadilhas do SheetJS encontradas ao montar as fixtures, e que valem para
quem for mexer nisto: `XLSX.write` falha com `RangeError` acima de cerca de 4
milhões de células, porque monta o ZIP inteiro como uma string só; e
`sheet_to_json` de meio milhão de linhas estoura a pilha se o resultado for
espalhado com `push(...)`.

## Por que o CSV progressivo ainda não está ligado

Medido com um CSV de 19,6 MiB e 200 mil linhas por 8 colunas:

| Estrutura | Memória |
| --- | ---: |
| Workbook do SheetJS | 164,5 MiB |
| Grade interna que a normalização monta (`sheet_to_json`) | 37,1 MiB |
| Linhas finais | 29,9 MiB |
| **Pico do caminho atual** | **231,5 MiB** |
| Grade do leitor progressivo, sem reaproveitar strings | 267,6 MiB |
| Grade do leitor progressivo, com reaproveitamento | **46,5 MiB** |
| **Pico progressivo possível** (grade mais linhas) | **76,5 MiB** |

Duas conclusões saem daí.

A primeira já foi aplicada: o analisador criava uma string nova por célula, 1,6
milhão delas, enquanto o SheetJS reaproveita as strings já alocadas no
workbook. Uma tabela de reaproveitamento com teto derrubou a grade de 267,6
para 46,5 MiB. Sem isso, qualquer desenho progressivo perderia para o atual
antes de começar.

A segunda ainda bloqueia a ligação. O ganho de 231,5 para 76,5 MiB só existe se
o caminho progressivo **não** materializar uma worksheet do SheetJS, que sozinha
custa 164,5 MiB. Mas toda a normalização depende dela: `sheetToRows(ws, wb)`,
`detectIndependentSections(ws)`, `independentSectionWorksheet(ws, ...)`,
`regionsAreSafeToSplit(ws, ...)` e `independentRegionWorksheet(ws, ...)`.
Montar uma worksheet a partir da grade lida em streaming devolve exatamente o
custo que se queria remover, e o resultado fica pior que o atual.

Ligar o CSV com ganho real exige, portanto, que a normalização passe a aceitar
uma grade além de uma worksheet. Isso é uma mudança em `import.ts`, o arquivo do
qual todo o corpus depende, e não cabe ser feita de passagem. Fica registrada
como decisão pendente, com o número que a justifica: 67% de redução de pico.

## Três atalhos testados e descartados

Antes de aceitar que a normalização precisa mudar, três formas de ligar o
leitor progressivo sem tocar em `import.ts` foram medidas. Todas perdem para o
caminho atual, e ficam registradas para ninguém repetir a tentativa.

| Tentativa | Worksheet | Pico total |
| --- | ---: | ---: |
| Grade acumulada sem reaproveitar strings | 193,7 MiB | 381,4 MiB |
| `aoa_to_sheet` esparso, com strings reaproveitadas | 193,7 MiB | 330,5 MiB |
| `aoa_to_sheet` denso, com strings reaproveitadas | 98,1 MiB | 234,9 MiB |
| **Caminho atual** | 164,5 MiB | **231,5 MiB** |

A forma densa foi a que mais se aproximou: ela corta a worksheet pela metade,
porque guarda células em arrays em vez de criar 1,6 milhão de propriedades com
chave. Ainda assim empata com o atual, e empate não justifica um segundo
caminho de código para manter, testar e divergir.

O motivo do empate é instrutivo. O custo das strings apenas **migra**: no
caminho atual, `XLSX.read` com `cellText` já materializa o texto formatado e as
linhas o reaproveitam; na construção a partir da grade, esse texto não existe e
a normalização o cria na hora, então o que sai da worksheet reaparece nas
linhas. Medido: as linhas custam 29,9 MiB pelo caminho atual e 90,3 MiB pelo
outro, com conteúdo idêntico e verificado célula a célula.

O ganho de 231,5 para 76,5 MiB continua existindo, e continua exigindo o mesmo:
a normalização precisa aceitar uma grade sem construir worksheet nenhuma. Não
há atalho.

## Desperdício encontrado no caminho atual

Procurando onde a normalização materializava texto formatado, apareceu algo que
não tem a ver com leitura progressiva e vale para toda importação, de todo
formato: `sheetOptionsForName` convertia a **aba inteira** para texto formatado
(`sheet_to_json` com `raw: false`) e usava apenas as doze primeiras linhas, para
checar se o arquivo era um relatório de compatibilidade do Excel. O resto era
alocado e descartado.

Medido isoladamente, numa aba de 200 mil linhas por 8 colunas:

| Chamada | Memória | Tempo | Linhas produzidas |
| --- | ---: | ---: | ---: |
| Aba inteira (antes) | 107,4 MiB | 1.415 ms | 200.001 |
| Só o topo (depois) | 0 MiB | 0 ms | 12 |

O custo era **por aba**: num workbook de doze abas, doze vezes. A correção
limita o intervalo às linhas que a checagem já lia, e a janela ficou fixada por
teste, para que um texto igual ao do relatório fora dela não faça uma aba de
dados legítima desaparecer.

Isso não altera o pico retido, porque a grade era transitória e o coletor a
levava embora. Altera o pico instantâneo e o tempo, que é o que trava a aba do
navegador e o que faz um arquivo grande encostar no prazo de 60s da leitura.

## A rede que faltava para a normalização

Antes de mexer na normalização, a pergunta certa é o que a protege. A resposta
encontrada foi desconfortável: **nada, sobre arquivo real**.

O corpus real cobre o **leitor**. `wasm-shadow-corpus` compara célula a célula
contra o núcleo Rust, e a inspeção OOXML confere o leitor principal. Nenhum
deles exercita `sheetsWithData`, que é onde moram a detecção de cabeçalho, a
divisão em regiões e a forma das linhas.

O teste que deveria cobrir isso, `real-workbook-corpus-validation`, procura
cinco arquivos por nome fixo em `upload/`. Nenhum dos cinco está presente neste
checkout, então ele é pulado inteiro, em silêncio, e a suíte segue verde.

`import-parity.test.ts` fecha a lacuna. Ele roda `sheetsWithData` sobre tudo o
que existir em `test-fixtures/sanitized-real` e em `upload/`, e compara com uma
referência gravada:

```bash
OLI_IMPORT_PARITY=write npx vitest run src/lib/import-parity.test.ts
npx vitest run src/lib/import-parity.test.ts
```

Nesta máquina são **25 arquivos e 110 abas normalizadas**, nenhuma recusada. A
referência guarda nome de aba, quantidade de linhas, chaves de coluna e um hash
dos valores; **nenhum valor de célula é gravado**, e a saída fica em
`test-results/`, que o Git ignora. Sem corpus ou sem referência, o teste é
pulado, e é por isso que ele não quebra a CI.

O modelo é de mestre dourado, e não de expectativa fixa, porque o corpus é
local e não versionado: nenhuma expectativa escrita no repositório poderia
valer para outra máquina.

## Refactor da normalização: primeiro incremento

O alvo é a normalização produzir linhas sem que uma worksheet do SheetJS seja
construída, que é o único caminho medido com ganho real (231,5 para 76,5 MiB).
`sheetToRows` tem 886 linhas e lê a worksheet em quinze pontos: `!ref`,
`!rows`, `!merges`, `!oliAdvanced`, fórmulas por endereço e seis chamadas de
diagnóstico. Trocar tudo de uma vez, num arquivo do qual o corpus inteiro
depende, é exatamente o que não se deve fazer.

O primeiro incremento é o mais estreito que rende: `sheetToRows` passou a
aceitar a grade já pronta, em vez de sempre reconstruí-la com `sheet_to_json`.
Quem lê por streaming já tem essa grade; sem isto ela seria descartada e
refeita, ao custo medido de 37 MiB e mais de um segundo por aba num arquivo de
200 mil linhas.

Quem passa a grade assume que ela corresponde à worksheet informada. Todo o
resto continua lendo a worksheet, porque mesclagem, fórmula, linha oculta e
diagnóstico não existem numa grade de valores. Nenhum chamador atual passa a
grade, então o comportamento de hoje é bit a bit o mesmo.

Verificado pela rede de paridade: **110 abas de 25 arquivos reais, resultado
idêntico**, mais um teste que confronta os dois modos diretamente.

Os próximos incrementos, na ordem de risco crescente: as leituras de metadado
(`!rows`, `!merges`, `!oliAdvanced`) aceitarem ausência declarada; o acesso por
endereço aceitar uma fonte sem worksheet; e por fim `detectIndependentSections`
e as duas construtoras de worksheet de região, que são as mais entrelaçadas.

### Segundo incremento: a worksheet mínima basta

A pergunta que decidia o tamanho do refactor era se `sheetToRows` conseguiria
trabalhar sem uma worksheet completa. A resposta, verificada e agora fixada por
teste: **consegue**. Uma worksheet contendo apenas `!ref`, somada à grade
passada pronta, produz as mesmas linhas, o mesmo aviso, o mesmo modo de tabela
e o mesmo diagnóstico naquilo que uma planilha sem formato pode ter.

Isso muda o tamanho do que falta. As quinze leituras de worksheet dentro de
`sheetToRows` são todas de metadado opcional (mesclagem, fórmula, linha oculta,
elemento visual), e todas já tratam ausência. Uma grade de valores não tem
nenhum desses, então a ausência é a resposta correta, não uma degradação.

O que continua faltando não é `sheetToRows`, e sim o caminho acima dele:
`sheetOptionsForName` precisa repassar a grade, e `detectIndependentSections`
com as duas construtoras de worksheet de região precisam de uma decisão. Elas
leem células para achar tabelas independentes dentro de uma aba; sobre uma
worksheet mínima elas não encontrariam nada, o que **mudaria** o resultado de
um CSV com várias regiões. Essa é a única parte do refactor que ainda exige
desenho, e não só ligação.

### Terceiro incremento: a detecção de regiões também aceita a grade

`detectIndependentSections` e `regionsAreSafeToSplit` liam a planilha do mesmo
jeito, com o mesmo mascaramento de linhas ocultas, em código duplicado. As duas
passaram a compartilhar `visibleTextGrid`, que aceita a grade de texto já
pronta pela mesma razão de `sheetToRows`: quem lê por streaming já a tem, e
refazê-la aqui custaria a planilha inteira formatada como texto **duas vezes**,
uma por função.

A duplicação entre as duas não era só peso: eram dois lugares onde o critério
de o que conta como linha visível podia divergir sem ninguém notar.

O mascaramento de linha oculta continua vindo da worksheet mesmo quando a grade
é informada, porque essa informação não existe numa grade de valores. Numa
fonte sem worksheet não há linha oculta, e a máscara é inofensiva.

O que falta agora é só o fatiamento: `independentSectionWorksheet` e
`independentRegionWorksheet` recortam uma worksheet nova copiando célula a
célula. Numa fonte de grade, o equivalente é recortar a grade, que é barato.
Esse é o último passo antes de `sheetOptionsForName` poder repassar tudo.

### Quarto incremento: o fatiamento sobre a grade

`independentSectionWorksheet` e `independentRegionWorksheet` recortam uma
worksheet nova copiando célula a célula, e também recortam mesclagens, linhas
ocultas e o pacote `!oliAdvanced` (hyperlinks, comentários, imagens, formas,
gráficos, cor de preenchimento), com remapeamento de intervalos.

Numa grade de valores nada disso existe. `sliceGridRegion` e `sliceGridSection`
fazem só o que sobra: recorte de linhas e colunas. As coordenadas são as mesmas,
relativas e começando em 1, para os dois caminhos poderem ser confrontados.

A garantia verificada não é o formato do recorte, e sim que **normalizar o
recorte da grade dá o mesmo que normalizar o recorte da worksheet**. A seleção
de linhas da seção preserva a ordem original (contexto na frente, sem
repetição), porque é ela que define qual linha vira cabeçalho do recorte.

Os dois fatiadores entram sem tocar nas funções existentes: são aditivos, e
nenhum caminho atual os chama. Com eles, todas as peças da normalização sobre
grade existem.

### O que falta para o ganho aparecer

Só a ligação: `sheetOptionsForName` precisa aceitar uma fonte de grade e
repassá-la para `sheetToRows`, para a detecção de regiões e para os fatiadores.
Enquanto isso não acontece, todas as peças estão prontas e testadas, e o
comportamento atual é bit a bit o mesmo, porque nenhum chamador usa as opções
novas.

### Quinto incremento: a ligação, e o ganho medido

`sheetOptionsForName`, `streamSheetsWithData` e `sheetsWithData` passaram a
aceitar uma fonte de grade e a repassá-la para a normalização, para a detecção
de regiões e para o fatiamento. É o ponto em que a leitura por streaming deixa
de precisar de uma worksheet completa.

Medido com 120 mil linhas por 8 colunas, contabilizando **todas** as estruturas
vivas de cada caminho:

| Caminho | Worksheet | Grade | Linhas | Pico |
| --- | ---: | ---: | ---: | ---: |
| Atual | 106,6 MiB | — | 60,5 MiB | **167,1 MiB** |
| Fonte de grade | 0 MiB | 22,4 MiB | 17,6 MiB | **40,0 MiB** |

**76% menos, com resultado idêntico célula a célula.**

Duas coisas explicam o ganho. A worksheet completa desaparece: a mínima tem só
`!ref` e custa zero. E as linhas ficam três vezes mais baratas, porque o
caminho atual materializa texto formatado por célula que as linhas depois
referenciam, enquanto a grade não tem esse texto para carregar.

O que a ligação **não** faz é escolher sozinha: nenhum chamador passa uma fonte
de grade ainda. `sheetsWithData(wb)` sem fonte continua idêntico, e a rede de
paridade sobre as 110 abas reais confirma isso. Falta o coordenador que junta o
seletor de estratégia, o leitor de CSV por streaming e esta ligação.
