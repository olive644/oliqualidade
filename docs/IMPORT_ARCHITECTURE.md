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
| CSV, TXT, TSV | Caminho atual | Streaming real com `Blob.stream()` |
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
