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

### A fase que a tabela acima não mede

A tabela vem de `npm run benchmark:import`, que percorre descompactação,
`XLSX.read` e linhas. Ela **não passa pela verificação**, e a verificação é a
maior fase de tempo da leitura, com cerca de 40% do prazo. O que ela materializa
não estava contabilizado em lugar nenhum.

São duas estruturas, e as duas ficam vivas ao mesmo tempo que o workbook do
leitor principal, porque é justamente contra ele que elas são comparadas:

| Estrutura da verificação | Do que é feita |
| --- | --- |
| Inventário por célula | Endereço, valor cru, texto exibido, formato e fórmula de **toda** célula |
| Worksheet de reparo | Uma segunda worksheet do SheetJS, por aba |

A segunda foi removida do caminho comum: ela agora é montada sob demanda, e o
que ela custava está medido abaixo. A primeira continua existindo, é o que a
comparação lê, e continua sem aparecer na tabela de cópias. Fica registrado
como a maior lacuna conhecida do baseline.

### O que ainda não foi medido

- O inventário por célula da verificação, acima. É a lacuna maior.
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
| CSV, TXT, TSV | **Caminho progressivo acima do teto de conforto**, caminho atual abaixo dele | Ligado por `csv-progressive-import.ts` |
| XLSX, XLSM, XLTX, XLTM | Caminho atual. Coordenador escrito, testado e com recusa contra divisão em seções (`ooxml-progressive-import.ts`), `support.ooxml` ainda `false`; recomendação registrada é ligar | Ligar `support.ooxml`; depois, acesso ao ZIP por entrada (streaming verdadeiro) |
| ODS e demais | Caminho atual | Sem plano de caminho progressivo |

O CSV está ligado; o OOXML não. Para ele o seletor continua devolvendo
`caminho-progressivo-indisponivel`, que é a verdade, e a distinção entre "não
vale a pena trocar" e "ainda não existe" continua valendo para quem lê a
telemetria.

## O que já existe e ajuda

`validateZipWorkbook` localiza o EOCD e percorre o diretório central do ZIP
**sem descompactar nada**, aplicando os limites de entradas, tamanho expandido e
razão de compressão. Operar isso sobre `Blob.slice()` em vez de sobre um
`Uint8Array` completo deixou de ser pendência: é `zip-blob-reader.ts`, na
última seção deste documento, junto da medida que diz quando ele paga.

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

### O que faltava para o ganho aparecer

Só a ligação: `sheetOptionsForName` precisava aceitar uma fonte de grade e
repassá-la para `sheetToRows`, para a detecção de regiões e para os fatiadores.
Isso é o quinto incremento, abaixo, e o coordenador que usa tudo isso está na
última seção deste documento.

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

O que a ligação **não** faz é escolher sozinha: `sheetsWithData(wb)` sem fonte
continua idêntico, e a rede de paridade sobre as 110 abas reais confirma isso.
Quem escolhe é o coordenador, na seção seguinte.

## O coordenador, e o ganho na tela

`csv-progressive-import.ts` junta as três peças. Ele reconhece o conteúdo pelos
primeiros 8 KiB do `Blob`, decide a codificação, lê o arquivo em blocos, monta a
grade e chama `sheetsWithData(wb, { gridFor })` com uma worksheet mínima.

```text
seleção do arquivo
  → chooseImportStrategy(nome, tamanho, aparelho, support)
  → estratégia "csv-progressivo"?
      não → caminho atual (arrayBuffer, worker, SheetJS)
      sim → postMessage(file)                 [referência, não bytes]
            → worker: readCsvWorkbookProgressively
                → checkWorkbookContent nos 8 KiB iniciais
                → sniffCsvEncoding              passagem que só conta
                → readCsvInBlocks               [única estrutura que cresce: a grade]
                → minimalWorksheetForGrid       só `!ref`
                → sheetsWithData(wb, gridFor)
            → postMessage por aba
```

Medido pelo próprio código entregue, em `src/lib/csv-progressive-benchmark.test.ts`:

```bash
OLI_CSV_BENCHMARK=1 NODE_OPTIONS=--expose-gc npx vitest run src/lib/csv-progressive-benchmark.test.ts
```

120 mil linhas por 8 colunas, arquivo de 8,4 MiB, 960 mil células, medindo no
ponto mais largo de cada caminho (o instante em que a aba fica pronta):

| Caminho | Pico | Tempo |
| --- | ---: | ---: |
| Atual | 141,8 MiB | 6.974 ms |
| Progressivo, blocos de 1.000 | **34,9 MiB** | 6.421 ms |
| Progressivo, blocos de 2.000 | 42,9 MiB | 6.514 ms |
| Progressivo, blocos de 5.000 | 41,8 MiB | 6.867 ms |

**75% menos memória, mesmo resultado, sem custo de tempo.** O tamanho de bloco
saiu daí: os tempos ficam dentro de 2% e trocam de posição a cada execução,
enquanto os picos se repetem até a décima de MiB, então o critério é o pico.

### O que a medição não diz

O pico de 34,9 MiB é de grade mais linhas. A grade **não** é limitada: a
normalização precisa da aba inteira para achar cabeçalho e regiões. O que
desapareceu foi o arquivo em memória e a worksheet do SheetJS. Descrever isto
como memória constante seria falso.

O benchmark roda em Node. O clone estrutural da aba na fronteira do worker
continua não medido aqui, como no baseline.

### Duas divergências que só aparecem confrontando os dois caminhos

Ao ligar, duas diferenças silenciosas apareceram, e ambas estão corrigidas.

O delimitador era decidido com o texto até a **primeira** quebra de linha,
enquanto `detectDelimiter` pontua 25 linhas e penaliza o candidato ausente em
parte delas. Um arquivo cuja primeira linha é um título com ponto e vírgula,
seguido de dados por vírgula, sairia como uma tabela de uma coluna. A janela
agora é a mesma da função que decide, com teto de 64 KiB.

A checagem de relatório de compatibilidade do Excel lia a worksheet, que numa
fonte de grade é mínima e não tem célula nenhuma. Ela passou a ler a grade.

Quem for ligar o caminho de OOXML deve esperar mais divergências desse tipo, e o
jeito de encontrá-las é o mesmo: confrontar os dois caminhos sobre muitas formas
do mesmo formato, nas linhas tipadas.

### Recusa contra indisponibilidade

`ProgressiveImportFallback` marca "este arquivo não é para este caminho" e faz o
leitor validado assumir, sem que a pessoa veja nada. Qualquer outro erro é
recusa e chega à tela. O worker devolve as duas em mensagens diferentes, porque
tipo de erro não sobrevive ao `postMessage`. O cliente só aceita o fallback
enquanto nenhuma aba tiver sido escoada.

## A worksheet de reparo, montada sob demanda

A verificação lê o pacote com um segundo leitor e compara célula a célula com o
principal. Para isso ela produzia duas coisas por aba: o **inventário**, que é o
que a comparação lê, e uma **worksheet completa**, que só é consultada quando há
reparo, ou seja quando o leitor principal perdeu uma célula ou uma aba inteira.

A worksheet era montada para toda aba de todo arquivo. Medido pelo código
entregue, com `OLI_BUDGET_BENCHMARK=1`, sobre 12 abas e 1,44 milhão de células:

| | Custo |
| --- | ---: |
| Worksheet de reparo, montada de véspera | **105,5 MiB** |
| O mesmo, montado sob demanda | 0, enquanto ninguém repara |

O tempo que ela custava é pequeno: 943 ms de 9.078 ms da leitura independente,
ou 3% do prazo. **Isto é uma mudança de memória, e não de tempo**, e a
distinção importa porque o alvo de tempo continua sendo outro (a seção seguinte
deste documento e a 155 do audit).

### Como a worksheet volta a existir sem ser guardada

O inventário já carrega tudo o que a célula da worksheet leva: valor cru, texto
exibido, formato numérico e fórmula. A data é a única que não viaja pronta, e
ela é recalculável do valor cru mais o formato, que é exatamente o que a leitura
original faz. O `!ref` passou a viajar na estrutura da aba, junto de mesclagens
e linhas ocultas, que já estavam lá.

Ou seja, **a reconstrução não retém nada a mais**: ela lê o que já está vivo. É
por isso que o desenho é reconstruir, e não guardar o XML da aba ou segurar o
pacote descompactado, que foram as duas alternativas descartadas por reintroduzir
retenção.

Três portas, pelo que cada consumidor precisa:

| Porta | Quem usa | O que monta |
| --- | --- | --- |
| `cellFor(aba, endereço)` | Reparo por célula | Uma célula |
| `worksheetFor(aba)` | Recuperação de aba que o principal perdeu | Uma aba |
| `workbook` | Fallback, quando o leitor principal falhou inteiro | Tudo, e memoizado |

`workbook` é memoizado porque quem o pede está **importando** aquele resultado e
escreve nele: o fallback marca cada aba com um diagnóstico. Uma cópia nova a
cada leitura perderia a marca.

### Como a garantia foi verificada

A rede de paridade não cobre este caminho: ela chama `sheetsWithData` sobre o
workbook do leitor principal e nunca passa pela verificação. Então a prova foi
feita contra a implementação anterior, sobre o corpus real: **25 arquivos, 110
abas, 312.392 células de inventário, zero divergências** em três níveis — a
worksheet reconstruída idêntica à que era montada, as divergências relatadas
idênticas, e o workbook depois do reparo idêntico célula a célula.

Essa comparação é de uma vez só, porque ela precisa das duas implementações. O
que fica no repositório é a garantia que se sustenta sozinha: uma inspeção cujo
`workbook` **lança** ao ser lido, e a verificação passando por cima dela. Sem
isso, a afirmação "a verificação não monta a worksheet" não seria observável, e
um teste que apenas confirmasse que a comparação funciona passaria dos dois
lados.

## O ZIP lido por posição

`zip-directory.ts` traz o formato e os limites do pacote, sem saber de onde os
bytes vieram. `validateZipWorkbook` e `zip-blob-reader.ts` são os dois
consumidores: um valida o pacote já em memória, o outro lê pelo disco. As regras
de segurança moram num lugar só, porque duas cópias delas seriam dois lugares
onde o critério pode divergir sem ninguém notar.

`openZipFromBlob` abre o pacote com duas leituras pequenas, a cauda onde o
registro de fim pode estar e o índice que ele aponta, e a partir daí entrega uma
entrada por vez, descompactando só ela.

Uma armadilha do formato, evitada explicitamente: o índice aponta para o
cabeçalho local, e não para o conteúdo. O cabeçalho local tem nome e campo extra
com tamanhos **próprios**, que não precisam coincidir com os do índice. Confiar
nos tamanhos do índice ali produz bytes deslocados em alguns pacotes.

### Quando isso paga, e quando não paga

Medido com `OLI_ZIP_BENCHMARK=1`, sobre tamanhos que o próprio pacote declara:

| Pacote | Entradas | Expandido total | Maior entrada |
| --- | ---: | ---: | ---: |
| 1 aba x 120 mil linhas | 10 | 37,2 MiB | 37,2 MiB (**100%**) |
| 12 abas x 10 mil linhas | 21 | 35,9 MiB | 3,0 MiB (**8%**) |

Os dois pacotes têm 13,9 MiB e o mesmo total de linhas. **Expandir uma entrada
por vez só ajuda quando existem várias entradas grandes.** Numa planilha de aba
única, a maior entrada é o pacote inteiro, e não há o que economizar.

Isso limita o alcance da peça de um jeito específico, e vale registrar: o caso
que motivou esta frente, o arquivo grande de uma tabela só, é exatamente o caso
em que ela não paga.

### Como medir memória aqui, e como não medir

Duas medições foram descartadas antes desta. Comparar memória viva usando o
`Blob` falso dos testes mede a cópia do teste, porque ele copia a cada fatia; a
fixture precisa ser um arquivo real aberto com `fs.openAsBlob`. E comparar
memória viva com `--expose-gc` entre dois cenários seguidos chegou a reportar um
caminho consumindo **menos vinte e dois MiB**, porque o lixo do primeiro era
coletado durante a medição do segundo.

A medida que ficou usa os tamanhos declarados pelo pacote, que são exatos, e
para obtê-los nada precisa ser expandido, que é a própria capacidade em teste.

### O que falta para o caminho progressivo de OOXML

Nada chama o leitor novo ainda. `inspectOoxml` já lê o pacote entrada por
entrada e é o candidato natural a receber este leitor, mas ele é síncrono e o
acesso por `Blob` é assíncrono: essa é uma decisão de desenho, e não uma
questão de esforço.

## A grade da aba, e por que ela ainda não serve

`readOoxmlSheetGrid` lê o XML de uma aba direto para uma grade densa, sem
worksheet nenhuma. Ao contrário do CSV, aqui `aoa` e `textAoa` **não**
coincidem: um número com formato de data é `Date` numa e texto formatado na
outra.

Confrontada com a worksheet do mesmo leitor, sobre o corpus real:

```text
25 planilhas reais com data
25 ainda divergem, em: celula, colunas, nome-de-aba, quantidade-de-abas, quantidade-de-linhas
0 já coincidem
```

A causa é única. `formatTemporalCell` decide granularidade, fuso e formato a
partir de `cell.z` e `cell.w` **da célula de origem**. Numa worksheet mínima não
existe célula, a data é descartada, a coluna de data perde valor ou some
inteira, e a coluna que some desloca a detecção de cabeçalho.

**Isso foi resolvido**: a grade passou a carregar o formato das datas, por
coluna quando ela é homogênea, e 17 das 25 planilhas reais passaram a normalizar
igual. O custo foi zero, porque o desenho por coluna sai de graça: a grade
entregue custa os mesmos 61,3 MiB, contra 235,8 da worksheet. Ver
[[CURRENT_STATE_AUDIT#153. A grade de OOXML ligada à normalização: de 25 divergências para 8]].

A régua por arquivo acima é grossa demais para decidir qualquer coisa daqui em
diante, e foi substituída pela contagem por aba: **110 abas pelo caminho atual,
101 pela grade, 87 idênticas**, ou 79%. O piso de 87 está escrito no teste. Ver
[[CURRENT_STATE_AUDIT#154. A régua por aba, e a resposta definitiva sobre a divisão em seções]].

O que separa dos 100% são duas causas, e nenhuma delas é "falta um campo na
grade".

**Fórmula volátil.** O caminho atual recalcula uma fórmula que depende de hoje,
para um cronograma de 2023 não mostrar o número de dias que faltavam quando o
arquivo foi salvo. Recalcular exige o texto da fórmula **e** acesso às outras
células, que é justamente o que uma grade não é. Esta é a fronteira real da
representação, e a decisão registrada é conviver com ela: uma aba com fórmula
volátil fica no caminho atual, em vez de a grade passar a recalcular ou a
aceitar o valor gravado.

**Divisão em seções.** Três hipóteses foram escritas, medidas e descartadas
aqui, e as três estão descritas no audit para ninguém reescrevê-las. A primeira
era que o recorte perdia mesclagem e linha oculta, porque
`minimalWorksheetForGrid` leva só o `!ref`; fazer o recorte passar pelos
fatiadores de worksheet **não mudou nada**. A segunda era que bastava
`detectIndependentSections` reconhecer banner sobre a grade; com a régua por
aba, esse conserto não faz **nenhuma** aba a mais coincidir, e só troca dividir
de menos por dividir de mais. A terceira era que `hasHorizontalMerge` (dentro
de `detectIndependentSections`) lia o valor da mesclagem pela worksheet, que
numa fonte de grade não tem célula nenhuma — trocar essa leitura pela grade de
texto **melhorou** um arquivo real (mesma quantidade e nomes de aba que o
caminho atual) mas **piorou** outro que antes batia perfeitamente, líquido de
17 para 16 em 25 planilhas. Alinhar as duas divisões continua sendo um
trabalho próprio, com critério de pronto próprio, e não um detalhe da ligação.
A solução aplicada não foi alinhar: foi reconhecer que uma divisão diferente é
sempre detectável pelo nome (`" · "`) e recusar o arquivo inteiro nesse caso —
ver "O coordenador, ligado e ainda desligado", abaixo.

O teste natural do outro lado, "em planilha real sem data a grade é
substituível", não pôde ser escrito: não existe planilha assim no corpus. Num
domínio de qualidade, data é coluna obrigatória.

### O que era a lacuna, e o custo que ela tinha, medido antes de fechá-la

O registro abaixo é de quando a lacuna ainda estava aberta, e fica porque é ele
que justifica o desenho escolhido. A lacuna era: **a grade precisa carregar o
formato numérico e o texto exibido das células de data**, e `sheetToRows`
precisa aceitá-los sem worksheet. Isso é mudança em `import.ts`, e trazia uma
pergunta de custo, porque guardar formato e texto por célula de data reintroduz
parte exata do que a grade existe para remover.

| Representação | Memória viva |
| --- | ---: |
| Worksheet, como o leitor monta hoje | 235,5 MiB |
| Grade de valores e de texto | 61,3 MiB |
| Grade mais o formato e o texto das datas | **72,2 MiB** |

O formato custa **10,8 MiB**, e a grade completa fica em **69% menos** que a
worksheet. A pergunta estava certa e a resposta é favorável: o par por célula de
data é barato perto do que ele destrava. Medido em 120 mil linhas por 8 colunas,
com uma coluna de data de verdade, e reproduzido até a décima de MiB entre
execuções (`OLI_GRID_BENCHMARK=1`).

Ou seja, a lacuna vale a pena fechar, e o próximo incremento tem número para
justificar-se antes de começar.

### Onde os pares moram, também medido antes de escolher

O mapa por endereço com o par completo é o mais simples de escrever, e não é o
mais barato. Duas observações o encolhem, e as duas foram medidas antes de virar
código.

A primeira é que o texto exibido **já** está na grade: `textAoa` guarda
exatamente o `w` que `formatTemporalCell` consulta, então guardá-lo de novo é
pagar duas vezes pela mesma string. A segunda é que o formato numérico repete:
uma coluna de data costuma ter um formato só, e o próprio pacote OOXML guarda
formatos por índice de estilo, e não por célula.

| Desenho | Custo sobre a grade |
| --- | ---: |
| Mapa por célula, com formato e texto | 10,8 MiB |
| Mapa por célula, só o formato | 6,3 MiB |
| Um formato por coluna | ~0 MiB |

O formato por coluna é praticamente de graça, mas só vale se a coluna for
homogênea, e isso é afirmação sobre planilha real, não sobre o formato OOXML.
Quem respondeu foi o corpus: **214 colunas de data, 13 com mais de um formato**,
ou seja 6%.

O desenho, então, está decidido e tem número: **formato por coluna quando ela é
homogênea, e por célula só nas que não são.** Os 94% saem de graça, e os 6%
pagam 6,3 MiB no pior caso. O texto exibido nunca é duplicado, porque a grade já
o tem.

## O coordenador, ligado e ainda desligado

`ooxml-progressive-import.ts` é a ligação que faltava: recebe os mesmos bytes
do caminho atual, descompacta uma vez, lê cada aba com `readOoxmlSheetGrids`,
monta um workbook mínimo com `!ref`/`!merges`/`!rows`
(`minimalWorksheetForOoxmlGrid`), anexa hyperlinks, comentários, imagens,
formas, gráficos e cor de preenchimento com `attachWorkbookFeatures` sobre o
mesmo pacote, e normaliza com `sheetsWithData(wb, { gridFor })`. Não roda
`XLSX.read` nem a verificação cruzada de `inspectOoxml`/`compareAndRepairWithOoxml`.

Medido pelo coordenador inteiro, e não pela grade isolada, com 120 mil linhas
por 8 colunas:

| Caminho | Pico | Tempo |
| --- | ---: | ---: |
| Atual | 337,4 MiB | 23.026 ms |
| Progressivo | **156,9 MiB** | **14.207 ms** |

53% menos memória, 38% mais rápido, mesma quantidade de linhas. É menos que os
76% da grade isolada porque o coordenador também mantém vivo o ZIP expandido
por inteiro e os recursos de `attachWorkbookFeatures`, que a medição da grade
sozinha não contabiliza.

`PROGRESSIVE_IMPORT_SUPPORT.ooxml` continua `false` por ora, mas o bloqueio
original — alinhar a divisão em seções antes de ligar — não foi resolvido por
alinhamento, e sim por recusa: o coordenador agora recusa (`ProgressiveImportFallback`)
qualquer arquivo em que alguma aba saia dividida (nome com o separador `" · "`,
que toda divisão em seções carrega), e o leitor validado assume no lugar sem a
pessoa perceber. Fórmula volátil continua sendo uma divergência com a qual se
convive (o valor sai como gravado, nunca perde dado), pela mesma razão já
registrada. Ver o comentário no topo de `ooxml-progressive-import.ts` e a
seção 169 do audit para a medição completa e a recomendação sobre ligar o
suporte.
