# Auditoria do estado atual â€” 2026-08-13

Base auditada: `main` em `4ec3ae0`, imediatamente antes da primeira correÃ§Ã£o
desta etapa. O cÃ³digo e os testes sÃ£o a fonte de verdade; este documento registra
o mapa, as lacunas e a ordem recomendada de evoluÃ§Ã£o.

## Resumo executivo

O projeto jÃ¡ possui uma arquitetura de leitura em camadas: SheetJS como leitor
principal, inspeÃ§Ã£o OOXML direta, ExcelJS como verificador sob demanda e um
contrato opcional para Rust/WASM. A importaÃ§Ã£o preserva uma grade de origem
limitada para revisÃ£o, representaÃ§Ãµes especiais de cÃ©lulas, fÃ³rmulas, perÃ­odos,
comentÃ¡rios, regiÃµes e diagnÃ³sticos. A geraÃ§Ã£o automÃ¡tica de widgets ocorre
depois da importaÃ§Ã£o e da classificaÃ§Ã£o semÃ¢ntica.

As trÃªs maiores lacunas sÃ£o: o inventÃ¡rio OOXML ainda nÃ£o cobre vÃ¡rios recursos
estruturais, a pontuaÃ§Ã£o de fidelidade nÃ£o diferencia tudo que foi validado do
que nÃ£o Ã© suportado, e o parsing OOXML ainda descompacta e percorre XML inteiro
em memÃ³ria. Antes desta etapa, a reconciliaÃ§Ã£o tambÃ©m ignorava silenciosamente
uma aba inteira ausente no leitor principal. A primeira implementaÃ§Ã£o corrige
essa perda.

## 1. Mapa da arquitetura atual

```mermaid
flowchart LR
  A[Arquivo local ou texto] --> B[workbook-reader-client]
  B --> C[workbook.worker]
  C --> D[Reading Engine]
  D --> E[SheetJS]
  D --> F[OOXML direto]
  D -. diagnÃ³stico sob demanda .-> G[ExcelJS]
  D -. adaptador opcional .-> H[Rust/WASM]
  E --> I[ReconciliaÃ§Ã£o]
  F --> I
  I --> J[sheetsWithData / sheetToRows]
  J --> K[ImportDiagnostics]
  K --> L[Modelo estrutural e temporal]
  L --> M[InteligÃªncia semÃ¢ntica]
  M --> N[Plano automÃ¡tico de widgets]
  N --> O[Painel e revisÃ£o]
  O --> P[IndexedDB e exportaÃ§Ãµes]
```

| Camada               | Componentes principais                                                    | Responsabilidade atual                                                   |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Entrada              | `workbook-reader-client.ts`, `workbook.worker.ts`                         | valida tamanho, transfere bytes e publica progresso                      |
| SeguranÃ§a            | `workbook-reader.ts`                                                      | limites de ZIP, abas, cÃ©lulas e formatos de texto                        |
| Leitores             | `workbook-reader.ts`, `ooxml-reader.ts`, `workbook-verifier.ts`           | SheetJS, OOXML direto e verificaÃ§Ã£o ExcelJS                              |
| Motor                | `workbook-reading-engine.ts`                                              | tempos, leitor usado, fallback e ponto de extensÃ£o WASM                  |
| ImportaÃ§Ã£o           | `import.ts`                                                               | cabeÃ§alhos, mesclagens, linhas ocultas, blocos e formatos especializados |
| DiagnÃ³stico          | `import-intelligence.ts`, `quality-audit.ts`                              | fÃ³rmulas, tipos, regiÃµes, notas, qualidade e confianÃ§a                   |
| Modelo intermediÃ¡rio | `spreadsheet-intelligence.ts`, `structural-model.ts`, `temporal-model.ts` | cÃ©lulas canÃ´nicas, papÃ©is semÃ¢nticos, regiÃµes e perÃ­odos                 |
| VisualizaÃ§Ã£o         | `auto-dashboard.ts`, `widgets.ts`, `operational-widgets.ts`               | recomendaÃ§Ãµes explicÃ¡veis e widgets por estrutura                        |
| OrquestraÃ§Ã£o         | `routes/index.tsx`                                                        | revisÃ£o, painel, filtros, configuraÃ§Ãµes e exportaÃ§Ãµes                    |
| PersistÃªncia         | `storage.ts`, `encrypted-backup.ts`                                       | IndexedDB local e backup criptografado                                   |

O grafo estrutural existente confirma os maiores pontos de acoplamento:
`types.ts`, `routes/index.tsx`, `import-intelligence.ts`,
`spreadsheet-intelligence.ts`, `import-workbench.ts`, `data-pipeline.ts`,
`widgets.ts`, `import.ts` e `auto-dashboard.ts`.

## 2. Lacunas de fidelidade

| Prioridade                             | Lacuna                                                                      | EvidÃªncia                                                                                                                                       | Impacto                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P0, corrigida nesta etapa              | Aba ausente era ignorada pela reconciliaÃ§Ã£o                                 | `compareAndRepairWithOoxml` seguia para a prÃ³xima aba quando `primary.Sheets[name]` nÃ£o existia                                                 | perda silenciosa de aba e pontuaÃ§Ã£o enganosa                                                      |
| P0, corrigida na seÃ§Ã£o 22              | PontuaÃ§Ã£o mede principalmente divergÃªncias celulares com severidade `error` | `fidelity-meter.ts` deduplica erros por endereÃ§o; avisos e recursos nÃ£o suportados nÃ£o entravam no denominador nem em lugar nenhum do relatÃ³rio | â€œ100%â€ podia significar apenas valores comparÃ¡veis sem erro                                       |
| P0                                     | InspeÃ§Ã£o OOXML usa `unzipSync` e regex sobre XML completo                   | `ooxml-reader.ts` e `workbook-metadata.ts` descompactam o pacote separadamente                                                                  | memÃ³ria duplicada e risco em arquivos grandes                                                     |
| P1, sistema 1904 corrigido na seÃ§Ã£o 25 | Leitor OOXML nÃ£o preserva colunas ocultas nem estado de abas                | `readSheet` lÃª linhas ocultas e formatos, mas nÃ£o `cols` nem `sheet state`; `workbookPr date1904` jÃ¡ Ã© lido e propagado                         | visibilidade ainda pode divergir no fallback; datas jÃ¡ respeitam o sistema 1904                   |
| P1                                     | Estilo preservado Ã© principalmente formato numÃ©rico/texto exibido           | `ReaderCell` nÃ£o carrega preenchimento, fonte, borda ou proteÃ§Ã£o                                                                                | cores com significado nÃ£o entram na reconciliaÃ§Ã£o                                                 |
| P1                                     | Limites de diagnÃ³sticos truncam sem contabilizar excedente                  | divergÃªncias: 2.000; representaÃ§Ãµes/notas: 500; perÃ­odos: 2.000                                                                                 | auditoria pode parecer completa quando foi limitada                                               |
| P1                                     | ExcelJS nÃ£o participa do fluxo normal de cada importaÃ§Ã£o                    | Ã© usado por `fidelity-meter.ts` e testes, nÃ£o pelo worker de leitura                                                                            | terceira opiniÃ£o existe apenas sob demanda                                                        |
| P2                                     | Recursos OOXML apenas detectados ou ainda nÃ£o inventariados                 | tabelas e pivÃ´s sÃ£o diagnosticados; imagens, grÃ¡ficos nativos, validaÃ§Ãµes, nomes definidos, links externos e desenhos nÃ£o tÃªm modelo completo   | o valor visÃ­vel pode sobreviver, mas o recurso nÃ£o Ã© explicÃ¡vel                                   |
| P2                                     | FÃ³rmulas entre abas e funÃ§Ãµes fora da lista dependem do cache               | `formula.ts` recusa referÃªncias externas/entre abas nÃ£o suportadas                                                                              | resultado sem cache fica indisponÃ­vel, corretamente sem invenÃ§Ã£o                                  |
| P2                                     | Abas vazias sÃ£o removidas da lista analÃ­tica                                | `sheetsWithData` retorna somente opÃ§Ãµes com linhas                                                                                              | Ãºtil para painel, mas exige inventÃ¡rio separado para afirmar que todas as abas foram reconhecidas |

â€œNÃ£o suportadoâ€ deve virar um estado explÃ­cito na auditoria; nÃ£o deve reduzir
automaticamente a nota como â€œincorretoâ€, nem ser contado como â€œvalidadoâ€.

## 3. InventÃ¡rio de formatos e recursos

### Formatos aceitos

- Excel/OOXML: XLSX, XLSM, XLSB, XLS, XLTX e XLTM.
- OpenDocument: ODS e FODS.
- Texto: CSV, TSV e TXT, com detecÃ§Ã£o de delimitador e codificaÃ§Ã£o.
- Outros leitores SheetJS: XML, HTML/HTM e Numbers.

### Recursos preservados ou diagnosticados

- abas e cÃ©lulas com valor bruto, texto exibido e formato numÃ©rico;
- fÃ³rmulas e valores armazenados, com recÃ¡lculo local limitado e seguro;
- datas e perÃ­odos, incluindo meses nomeados e cabeÃ§alhos temporais;
- cÃ©lulas mescladas e cabeÃ§alhos hierÃ¡rquicos;
- linhas ocultas excluÃ­das de registros/widgets, mas preservadas na origem;
- colunas ocultas detectadas em diagnÃ³stico;
- comentÃ¡rios e blocos textuais de observaÃ§Ã£o;
- filtros, tabelas estruturadas, colunas calculadas e tabelas dinÃ¢micas em diagnÃ³stico;
- regiÃµes independentes, blocos repetidos, formulÃ¡rios, matrizes e cronogramas;
- origem por aba/endereÃ§o nas cÃ©lulas canÃ´nicas e nas exceÃ§Ãµes;
- limites de ZIP, dimensÃµes, nÃºmero de abas e cÃ©lulas.

### Parcial ou nÃ£o suportado de forma completa

Reauditado em 2026-08-15 (seÃ§Ã£o 50) â€” verificado por cÃ³digo, nÃ£o por
memÃ³ria do documento; a lista abaixo reflete o estado real de hoje:

- fills, fontes, bordas e cores semÃ¢nticas na reconciliaÃ§Ã£o â€” sem mudanÃ§a;
- imagens, desenhos, objetos e grÃ¡ficos nativos â€” sem mudanÃ§a, zero inventÃ¡rio;
- validaÃ§Ãµes de dados, agrupamentos/outlines e segmentaÃ§Ãµes (slicers) â€” sem mudanÃ§a;
- **hyperlinks: parcialmente evoluÃ­do.** Parsing estruturado existe
  (`parseHyperlinks`, `workbook-metadata.ts:117-143`, endereÃ§o + destino +
  tooltip), mas sÃ³ alimenta `cell.l` do SheetJS cÃ©lula a cÃ©lula â€” nÃ£o vira
  inventÃ¡rio consultÃ¡vel em lugar nenhum (nenhuma UI, relatÃ³rio ou
  diagnÃ³stico lista os hyperlinks do arquivo);
- nomes definidos e links externos: zero leitura, sem mudanÃ§a;
- macros VBA: nunca executadas e ainda sem inventÃ¡rio detalhado â€” sem mudanÃ§a;
- recÃ¡lculo integral de fÃ³rmulas do Excel: escopo cresceu marginalmente
  (`SUMIF`/`COUNTIF` alÃ©m do aritmÃ©tico/lÃ³gico/`SUM`/`AVERAGE`/`COUNT`/
  `MIN`/`MAX`), mas continua sem referÃªncia entre abas, sem lookup
  (`VLOOKUP`/`XLOOKUP`/`INDEX`/`MATCH`) e sem motor completo;
- arquivos XLS/Numbers/ODS parcialmente corrompidos sem leitor alternativo â€” sem mudanÃ§a;
- auditoria de abas vazias/ocultas separada das opÃ§Ãµes analÃ­ticas â€” sem
  mudanÃ§a; `buildSheetConfidenceMatrix` (seÃ§Ã£o 28) nÃ£o resolve isso, porque
  opera sÃ³ sobre abas jÃ¡ filtradas por `sheetsWithData` (que continua
  excluindo abas sem dado por definiÃ§Ã£o); nÃ£o existe leitura de
  visibilidade de aba (`Hidden`/`SheetVisibility`) em nenhum lugar.

## 4. Matriz de cobertura dos leitores

Legenda: **P** principal, **V** verificaÃ§Ã£o/reconciliaÃ§Ã£o, **D** diagnÃ³stico sob
demanda/teste, **C** contrato sem implementaÃ§Ã£o e **â€”** sem cobertura.

| Formato      | SheetJS | OOXML direto |   ExcelJS | Rust/WASM |
| ------------ | ------: | -----------: | --------: | --------: |
| XLSX         |       P |            V |         D |         C |
| XLSM         |       P |            V | D parcial |         C |
| XLTX/XLTM    |       P |            V | D parcial |         C |
| XLS/XLSB     |       P |            â€” |         â€” |         â€” |
| ODS          |       P |            â€” |         â€” |         D |
| FODS         |       P |            â€” |         â€” |         â€” |
| CSV/TSV/TXT  |       P |            â€” |         â€” |         â€” |
| XML/HTML/HTM |       P |            â€” |         â€” |         â€” |
| Numbers      |       P |            â€” |         â€” |         â€” |

| Recurso                | SheetJS |            OOXML direto |   ExcelJS | Resultado atual                 |
| ---------------------- | ------: | ----------------------: | --------: | ------------------------------- |
| valor e tipo           |       P |                       V |         D | reconciliado por endereÃ§o       |
| fÃ³rmula/cache          |       P |                       V | D parcial | preservado; recÃ¡lculo limitado  |
| texto formatado/numFmt |       P |                       V |         D | comparÃ¡vel                      |
| mesclagens             |       P |                 parcial |         D | importador reconstrÃ³i estrutura |
| linhas ocultas         |       P |                       V |         D | removidas da saÃ­da analÃ­tica    |
| colunas ocultas        |       P |                       â€” |         D | apenas diagnosticadas           |
| comentÃ¡rios            |       P |                       â€” |         D | preservados via SheetJS         |
| tabelas/pivÃ´s          | parcial | inventÃ¡rio complementar |   parcial | diagnÃ³stico, sem recÃ¡lculo      |
| estilos visuais        | parcial |                  numFmt |   parcial | sem reconciliaÃ§Ã£o completa      |
| desenhos/grÃ¡ficos      | parcial |                       â€” |   parcial | sem modelo intermediÃ¡rio        |

## 5. Riscos de regressÃ£o

1. `routes/index.tsx` concentra 41 relaÃ§Ãµes e grande parte do estado visual;
   mudanÃ§as de widget podem afetar importaÃ§Ã£o, filtros e persistÃªncia.
2. `import.ts` contÃ©m muitas heurÃ­sticas especializadas; uma regra genÃ©rica de
   cabeÃ§alho ou regiÃ£o pode quebrar cronogramas e formulÃ¡rios jÃ¡ cobertos.
3. Mesclagens e preenchimento de valores exigem distinguir rÃ³tulo estrutural de
   observaÃ§Ã£o; replicar texto longo cria dados falsos.
4. Linhas/colunas ocultas nÃ£o podem alimentar widgets sem decisÃ£o explÃ­cita;
   a regressÃ£o `4s` prova o risco.
5. Datas dependem de valor, formato, texto exibido e fuso; usar apenas serial
   volta a criar anos ou dias errados.
6. A promoÃ§Ã£o do WASM sem corpus de paridade pode trocar um fallback estÃ¡vel por
   um leitor mais rÃ¡pido, porÃ©m menos fiel.
7. Limites de amostragem para UI nÃ£o podem ser reutilizados pela auditoria.
8. A separaÃ§Ã£o automÃ¡tica de regiÃµes pode dividir uma tabela com espaÃ§adores ou
   misturar blocos se a confianÃ§a nÃ£o for respeitada.

## 6. Gargalos de desempenho

- O parsing principal jÃ¡ roda em worker, mas SheetJS, `inspectOoxml` e
  `attachWorkbookFeatures` podem descompactar/percorrer o mesmo arquivo em fases
  distintas.
- `unzipSync` mantÃ©m o pacote expandido inteiro em memÃ³ria; XML streaming ainda
  nÃ£o existe.
- `sheetMeta` percorre toda a dimensÃ£o declarada, inclusive cÃ©lulas vazias, para
  contar fÃ³rmulas e montar diagnÃ³sticos. DimensÃµes infladas custam CPU mesmo sob
  o limite global.
- O armazenamento de representaÃ§Ãµes, notas e perÃ­odos tem limites, mas o laÃ§o
  continua percorrendo a dimensÃ£o completa.
- `routes/index.tsx` continua sendo o maior chunk e o maior ponto de renderizaÃ§Ã£o.
- Baseline medido: `workbook.worker` 442,86 kB; maior chunk inicial 302,03 kB;
  XLSX tardio 492,63 kB; Leaflet tardio 813,55 kB.
- O orÃ§amento de produÃ§Ã£o passa, mas o build alerta para mÃ³dulos acima de 500 kB
  no servidor; esses mÃ³dulos devem permanecer fora do caminho inicial.

MÃ©tricas que ainda precisam ser registradas por importaÃ§Ã£o: ~~bytes compactados
e expandidos~~, ~~tempo por leitor~~ â€” registrados desde a seÃ§Ã£o 37 â€”, cÃ©lulas
realmente visitadas, pico estimado de memÃ³ria, tempo de reconciliaÃ§Ã£o,
truncamentos de diagnÃ³stico e cancelamento (cancelamento por `AbortError` Ã©
deliberadamente excluÃ­do do registro de falhas, ver seÃ§Ã£o 37).

## 7. Plano incremental para o nÃºcleo Rust

1. Congelar um contrato JSON versionado para inventÃ¡rio de workbook, abas,
   dimensÃµes, visibilidade e limites de recursos.
2. Criar crate isolado, sem integrar a UI, usando ZIP com limites e XML pull/stream.
3. Entregar primeiro apenas inventÃ¡rio OOXML: partes, abas, relaÃ§Ãµes, estado,
   sistema de datas e dimensÃµes declaradas/reais.
4. Adicionar shared strings, cÃ©lulas, fÃ³rmulas/cache, numFmt, mesclagens e regiÃµes
   ocultas, mantendo valores bruto e exibido separados.
5. Compilar para WASM e implementar o contrato jÃ¡ aceito por
   `registeredWasmWorkbookReader`.
6. Executar Rust e TypeScript lado a lado; nunca promover o resultado Rust antes
   da paridade por formato e fixture.
7. Acrescentar comentÃ¡rios, hyperlinks, tabelas, pivÃ´s, desenhos e nomes
   definidos como inventÃ¡rio, sem executar conteÃºdo.
8. Medir tempo, memÃ³ria e tamanho WASM; promover por formato com fallback.

Bibliotecas devem ser escolhidas por cobertura e manutenÃ§Ã£o, nÃ£o por
popularidade. CritÃ©rios mÃ­nimos: ZIP com limites, XML streaming sem entidades,
Serde, WASM estÃ¡vel, datas 1900/1904, fÃ³rmulas/cache, estilos e relaÃ§Ãµes OOXML.

## 8. Plano de testes de paridade

1. Definir manifesto JSON por fixture com hash, abas, estados, dimensÃµes reais,
   cÃ©lulas crÃ­ticas, fÃ³rmulas, mesclagens, ocultos, notas e recursos conhecidos.
2. Rodar SheetJS, OOXML TypeScript, ExcelJS e Rust sobre os mesmos bytes.
3. Comparar existÃªncia, tipo, bruto, cache, display, fÃ³rmula, numFmt, visibilidade,
   comentÃ¡rio e hyperlink por endereÃ§o.
4. Classificar cada diferenÃ§a como incorreta, representaÃ§Ã£o equivalente,
   nÃ£o suportada ou nÃ£o validÃ¡vel.
5. Exigir zero perda silenciosa e registrar todo truncamento.
6. Manter fixtures sintÃ©ticas pequenas para cada recurso e fixtures reais apenas
   locais/sanitizadas, sempre com `skipIf` seguro.
7. Cobrir arquivos pequeno, largo, profundo, muitas abas, estilos vazios,
   mesclagens, fÃ³rmulas, corrompido e ZIP bomb simulada segura.
8. Coletar tempo e memÃ³ria por leitor; falha de desempenho nÃ£o deve alterar a
   decisÃ£o de fidelidade.

Gate de promoÃ§Ã£o Rust: todos os manifests crÃ­ticos iguais ou com divergÃªncias
explicitamente aceitas, sem regressÃ£o de seguranÃ§a, e ganho medido no corpus de
arquivos grandes.

## 9. TrÃªs melhorias de maior impacto

1. **RelatÃ³rio de fidelidade explicÃ¡vel:** separar validado, divergente,
   reparado, nÃ£o suportado e truncado por aba/bloco/cÃ©lula.
2. **InventÃ¡rio OOXML seguro e Ãºnico:** uma descompactaÃ§Ã£o limitada, XML
   streaming e cobertura de visibilidade, datas 1904, relaÃ§Ãµes e recursos.
3. **NÃºcleo Rust em shadow mode:** inventÃ¡rio e cÃ©lulas lado a lado com o motor
   atual, promovidos apenas apÃ³s paridade.

## 10. Primeira implementaÃ§Ã£o mensurÃ¡vel

A reconciliaÃ§Ã£o agora recupera uma aba inteira encontrada pelo OOXML e ausente
no SheetJS. A aba Ã© anexada ao workbook principal e cada cÃ©lula recuperada gera
uma `ReaderDivergence` com aba, endereÃ§o, valor independente, severidade `error`
e `repaired: true`.

Prova sintÃ©tica adicionada em `workbook-fidelity.test.ts`:

- comeÃ§a com workbook principal sem abas;
- reconcilia contra a fixture pÃºblica OOXML;
- confirma a restauraÃ§Ã£o de `CabeÃ§alho deslocado`;
- confirma o valor `Data` em `A4`;
- confirma diagnÃ³stico rastreÃ¡vel e reparado para `A4`.

Resultado mensurÃ¡vel: o cenÃ¡rio passou de **zero abas e zero divergÃªncias
registradas** para **aba restaurada e uma divergÃªncia reparada por cÃ©lula de
origem**. O limite global de 2.000 divergÃªncias continua sendo uma lacuna a ser
tratada no relatÃ³rio de fidelidade.

## Baseline de validaÃ§Ã£o

Antes da mudanÃ§a, no ambiente Windows isolado:

- TypeScript: aprovado;
- build de produÃ§Ã£o: aprovado apÃ³s evitar o mapeamento de unidade de rede do
  Vite, uma limitaÃ§Ã£o do sandbox;
- testes: 45 arquivos, 42 aprovados e 3 ignorados com seguranÃ§a; 388 testes
  aprovados e 11 ignorados;
- lint: 10 diferenÃ§as de formataÃ§Ã£o preexistentes em 5 arquivos, a normalizar
  antes da publicaÃ§Ã£o desta etapa.

O briefing citava 404 testes. O checkout atual em `4ec3ae0` possui 399 testes
contabilizados antes desta implementaÃ§Ã£o; a nova regressÃ£o eleva o inventÃ¡rio
para 400. A diferenÃ§a deve ser tratada como mudanÃ§a de inventÃ¡rio, nÃ£o como
evidÃªncia automÃ¡tica de perda de cobertura.

ApÃ³s a implementaÃ§Ã£o e a normalizaÃ§Ã£o estritamente mecÃ¢nica dos cinco arquivos:

- testes: 45 arquivos, 42 aprovados e 3 ignorados; 389 testes aprovados e 11
  ignorados, total de 400;
- TypeScript: aprovado;
- ESLint/Prettier: aprovado com adaptaÃ§Ã£o de fim de linha do checkout Windows;
- build de produÃ§Ã£o: aprovado;
- orÃ§amento de desempenho: aprovado;
- dependÃªncias de produÃ§Ã£o: zero vulnerabilidades no `npm audit --omit=dev`;
- dependÃªncias de desenvolvimento: duas vulnerabilidades moderadas herdadas de
  `exceljs -> uuid`, sem correÃ§Ã£o disponÃ­vel no inventÃ¡rio atual.

## 11. NÃºcleo Rust de inventÃ¡rio OOXML â€” fase 1

O primeiro recorte do plano incremental foi implementado no crate isolado
`rust/oli-ooxml-core`, ainda fora do leitor produtivo e do adaptador WASM. O
contrato JSON `1.0.0` estÃ¡ congelado em
`contracts/ooxml-inventory.schema.json`.

Cobertura entregue:

- validaÃ§Ã£o prÃ©via de quantidade de entradas, tamanho individual e agregado,
  razÃ£o de compactaÃ§Ã£o, criptografia e caminhos inseguros/duplicados no ZIP;
- leitura XML orientada a eventos, limitada tambÃ©m por nÃºmero de eventos;
- ordem, nome, identificador, relaÃ§Ã£o, caminho e estado
  `visible`/`hidden`/`veryHidden` das abas;
- sistema de datas 1900/1904;
- dimensÃ£o declarada e dimensÃ£o real calculada pelas referÃªncias de cÃ©lulas;
- mÃ©tricas do pacote, limites aplicados e diagnÃ³sticos estruturados;
- CLI JSON para inspeÃ§Ã£o local e workflow dedicado no GitHub.

Os testes incluem fixture sintÃ©tica com abas ocultas e data 1904, caminho ZIP
inseguro, limite de recurso reduzido e paridade de inventÃ¡rio com
`test-fixtures/problematic-import.xlsx`. A fase seguinte de shared strings,
cÃ©lulas, fÃ³rmulas/cache e formatos Ã© registrada abaixo; o crate ainda nÃ£o foi
compilado para WASM nem executado lado a lado com o leitor atual.

## 12. NÃºcleo Rust de cÃ©lulas OOXML â€” fase 2

O crate `oli-ooxml-core` passou a emitir o contrato JSON `2.0.0`. A mudanÃ§a de
versÃ£o Ã© intencional porque cada aba agora inclui o inventÃ¡rio de cÃ©lulas, alÃ©m
dos metadados da fase 1.

Cobertura acrescentada:

- shared strings simples e rich text, preservando a concatenaÃ§Ã£o dos trechos;
- strings inline, strings armazenadas, nÃºmeros, booleanos, erros e datas ISO;
- fÃ³rmula separada do valor em cache, mantendo `rawValue` e `displayValue`;
- Ã­ndice de estilo, formatos numÃ©ricos nativos conhecidos e formatos customizados;
- exibiÃ§Ã£o conservadora para inteiros, decimais e percentuais, sem inventar a
  renderizaÃ§Ã£o de formatos Excel ainda nÃ£o implementados;
- limites de 2 milhÃµes de cÃ©lulas, 2 milhÃµes de shared strings e 256 MiB de
  texto por parte XML, alÃ©m dos limites de ZIP e eventos jÃ¡ existentes;
- rejeiÃ§Ã£o de entidades XML nÃ£o predefinidas, mantendo DOCTYPE proibido.

A paridade da fixture pÃºblica agora verifica tambÃ©m as 34 cÃ©lulas da primeira
aba, o cabeÃ§alho `A4`, a fÃ³rmula `G5` e seu cache numÃ©rico. A fixture sintÃ©tica
cobre rich text, entidade XML, booleano, percentual, formato customizado, erro
e data. O crate permanece fora do caminho produtivo; a cobertura de
datas/formatos, mesclagens e regiÃµes ocultas foi concluÃ­da abaixo antes do
adaptador WASM em shadow mode.

## 13. NÃºcleo Rust de fidelidade estrutural OOXML â€” fase 3

O contrato JSON passa para `3.0.0`, pois cada aba agora exige tambÃ©m os campos
`mergedRanges`, `hiddenRows` e `hiddenColumns`. O crate passa da versÃ£o `0.2.0`
para `0.3.0` e continua isolado do caminho produtivo.

Cobertura acrescentada:

- conversÃ£o de datas seriais nos sistemas Excel 1900 e 1904, preservando o
  valor numÃ©rico bruto e emitindo `dateValue` local normalizado;
- tratamento explÃ­cito do dia fictÃ­cio 29/02/1900: a exibiÃ§Ã£o compatÃ­vel Ã©
  preservada, o valor ISO invÃ¡lido nÃ£o Ã© emitido e um diagnÃ³stico Ã© registrado;
- reconhecimento conservador de formatos de data/hora, formatos nativos 14â€“22
  e 45â€“47, duraÃ§Ã£o `[h]:mm:ss` e formatos customizados comuns;
- inventÃ¡rio validado de mesclagens, linhas ocultas e intervalos compactos de
  colunas ocultas, sem expandir intervalos potencialmente grandes;
- limite configurÃ¡vel de 500 mil registros estruturais por aba, somado aos
  limites de cÃ©lulas, texto, eventos XML e pacote ZIP;
- regressÃµes sintÃ©ticas para data 1904, duraÃ§Ã£o, formato customizado, mesclagem,
  estruturas ocultas e limite reduzido, alÃ©m da paridade estrutural da fixture
  pÃºblica.

A etapa de compilaÃ§Ã£o e shadow mode foi concluÃ­da abaixo.

## 14. Adaptador WASM em shadow mode â€” fase 4

O crate `oli-ooxml-core` passa Ã  versÃ£o `0.4.0` e gera um mÃ³dulo WebAssembly
para navegador. O contrato de inventÃ¡rio permanece `3.0.0`; nÃ£o houve mudanÃ§a
incompatÃ­vel na saÃ­da JSON.

IntegraÃ§Ã£o entregue:

- exportaÃ§Ã£o `inventory_ooxml_json` restrita ao alvo `wasm32`, mantendo a API
  Rust nativa e a CLI existentes;
- pacote web gerado por `wasm-pack --target web`, versionado em `src/wasm` para
  que o deploy da Vercel nÃ£o dependa de uma toolchain Rust;
- registro automÃ¡tico dentro do worker de leitura para XLSX, XLSM, XLTX e XLTM;
- execuÃ§Ã£o somente depois que SheetJS e o verificador OOXML TypeScript jÃ¡
  produziram o resultado validado;
- comparaÃ§Ã£o de nomes de abas e, por endereÃ§o, valor bruto, texto exibido e
  fÃ³rmula, com tolerÃ¢ncia numÃ©rica mÃ­nima;
- relatÃ³rio separado de disponibilidade, estado (`matched`, `diverged`,
  `failed` ou `unavailable`), tempo, cÃ©lulas comparadas, cÃ©lulas/abas divergentes
  e versÃ£o do contrato;
- falha, contrato invÃ¡lido ou divergÃªncia no WASM nunca altera linhas, reparos,
  diagnÃ³sticos produtivos nem impede a importaÃ§Ã£o;
- smoke test do binÃ¡rio real contra `problematic-import.xlsx`, alÃ©m de testes de
  paridade simulada e de falha nÃ£o bloqueante;
- CI ampliada com compilaÃ§Ã£o para `wasm32-unknown-unknown` e execuÃ§Ã£o do smoke
  test sobre o artefato versionado.

O prÃ³ximo passo seguro Ã© coletar a distribuiÃ§Ã£o das divergÃªncias no corpus de
produÃ§Ã£o e definir critÃ©rios objetivos de promoÃ§Ã£o por formato antes de permitir
que o Rust participe do resultado produtivo.

## 21. InventÃ¡rio ODS complementar â€” fase 11

O crate `oli-ooxml-core` ganhou um segundo leitor, isolado do fluxo XLSX, para
OpenDocument Spreadsheet (ODS), o formato universal ISO/IEC 26300 que hoje sÃ³
tinha cobertura via SheetJS no caminho TypeScript (linha "ODS" da matriz de
formatos, coluna Rust/WASM: de contrato sem implementaÃ§Ã£o para diagnÃ³stico
testado). O contrato JSON continua `3.0.0`; o campo `format` passa a aceitar
`"ooxml"` ou `"ods"`, mantendo o restante do formato do inventÃ¡rio.

Cobertura entregue pelo mÃ³dulo `src/ods.rs`:

- reaproveita a validaÃ§Ã£o de pacote ZIP, os limites de recursos e o modelo de
  inventÃ¡rio (abas, dimensÃµes, mesclagens, ocultos, cÃ©lulas) jÃ¡ usados pelo
  nÃºcleo OOXML, sem duplicar a lÃ³gica de seguranÃ§a;
- abas, cÃ©lulas tipadas (texto, nÃºmero, booleano, data/hora, percentual,
  moeda), fÃ³rmulas (`table:formula`, normalizadas para o mesmo prefixo `=`
  usado no XLSX) e mesclagens por `number-columns/rows-spanned`;
- colunas e linhas ocultas via `table:visibility="collapse"/"filter"`;
- datas ODF jÃ¡ vÃªm como texto ISO em `office:date-value`; quando o arquivo
  grava sÃ³ a data, o horÃ¡rio Ã© normalizado para meia-noite para manter o
  mesmo formato `dateValue` do contrato compartilhado.

CÃ©lulas e linhas repetidas (`table:number-columns-repeated`,
`table:number-rows-repeated`, usadas pelo ODF sobretudo para preencher
espaÃ§o vazio Ã  direita/abaixo, com contadores que podem chegar a centenas
de milhares) sÃ£o representadas de forma **compacta e sem perda**: cada
bloco retangular de cÃ©lulas idÃªnticas vira um Ãºnico registro de cÃ©lula com
os novos campos `repeatColumns`/`repeatRows` (contrato JSON, ambos
opcionais, omitidos quando o valor Ã© 1). `actualDimension` e a contagem de
cÃ©lulas da aba refletem a extensÃ£o lÃ³gica real do bloco, nÃ£o apenas a
Ã¢ncora â€” corrigindo uma limitaÃ§Ã£o da primeira versÃ£o deste leitor, em que
somente a primeira ocorrÃªncia era materializada e a dimensÃ£o/contagem
podiam parecer menores que a estrutura declarada. O custo de processar um
bloco repetido continua O(1) por elemento do XML (nenhum laÃ§o proporcional
ao contador de repetiÃ§Ã£o), e o limite de cÃ©lulas do pacote passa a ser
aplicado sobre a extensÃ£o lÃ³gica total, nÃ£o sobre o nÃºmero de registros
JSON.

Testes em `tests/ods_inventory.rs` cobrem tipos de cÃ©lula e dimensÃ£o real,
fÃ³rmula e mesclagem preservadas com linha/coluna oculta, e a representaÃ§Ã£o
compacta de blocos repetidos (incluindo um caso de 1.000.000 de linhas
repetidas vazias), confirmando `repeatColumns`/`repeatRows`, a dimensÃ£o
real completa e a contagem de cÃ©lulas lÃ³gica â€” sem materializar nem
descartar nenhuma cÃ©lula.

O leitor ODS ainda nÃ£o estÃ¡ integrado ao `workbook.worker` nem ao adaptador
WASM em shadow mode; Ã© uma capacidade isolada do crate, seguindo a mesma
progressÃ£o incremental usada para o XLSX (fases 1 a 10 acima) antes de
qualquer integraÃ§Ã£o no caminho produtivo. Os prÃ³ximos passos seguros sÃ£o:
compilar para `wasm32-unknown-unknown`, expor `inventory_ods_json` ao
worker como leitor adicional (nÃ£o substituto do SheetJS) e sÃ³ entÃ£o avaliar
paridade contra um corpus real de arquivos ODS sanitizados.

## 22. "NÃ£o suportado" como estado explÃ­cito na pontuaÃ§Ã£o de fidelidade

Corrige a lacuna P0 registrada na seÃ§Ã£o 2: `fidelity-meter.ts` deduplicava
apenas divergÃªncias de severidade `error` num Ãºnico mapa e descartava
qualquer coisa de severidade `warning` sem registrar em lugar nenhum do
relatÃ³rio. Um score de 100% podia entÃ£o significar tanto "tudo comparado e
igual" quanto "vÃ¡rios avisos silenciados". NÃ£o havia, alÃ©m disso, nenhum
jeito de o relatÃ³rio dizer que fills, imagens, validaÃ§Ãµes de dados, nomes
definidos/hyperlinks, macros VBA e recÃ¡lculo integral de fÃ³rmulas nunca sÃ£o
comparados cÃ©lula a cÃ©lula por nenhum leitor â€” esses recursos eram
invisÃ­veis ao medidor de fidelidade, nem contados como validados nem como
divergentes.

`WorkbookFidelityReport` ganhou dois campos, sem alterar a fÃ³rmula da
pontuaÃ§Ã£o nem o campo `divergences` existente (que continua sendo apenas
erros, preservando os testes de meta mÃ­nima de 99%):

- `warnings`: as divergÃªncias de severidade `warning`, deduplicadas por
  endereÃ§o como antes, agora visÃ­veis em vez de descartadas;
- `unsupportedFeatures`: lista estÃ¡tica e explÃ­cita dos recursos da seÃ§Ã£o 3
  que nenhum leitor reconcilia hoje. Por decisÃ£o de projeto, "nÃ£o suportado"
  nÃ£o soma nem subtrai da pontuaÃ§Ã£o â€” Ã© um estado prÃ³prio, nem "validado"
  nem "incorreto", como jÃ¡ estava registrado como princÃ­pio neste documento
  mas ainda nÃ£o implementado.

Teste adicionado em `workbook-fidelity.test.ts` confirma que `warnings` sÃ³
contÃ©m severidade `warning`, que `divergences` sÃ³ contÃ©m severidade `error`
e que `unsupportedFeatures` inclui "Macros VBA". Nenhum consumidor de
produÃ§Ã£o usa `fidelity-meter.ts` hoje (sÃ³ os dois arquivos de teste), entÃ£o
a mudanÃ§a de forma do retorno nÃ£o tem risco de regressÃ£o na UI.

## 15. MediÃ§Ã£o de corpus e gate de promoÃ§Ã£o â€” fase 5

O shadow mode agora possui amostragem determinÃ­stica configurÃ¡vel por
`VITE_WASM_SHADOW_SAMPLE_RATE`. Arquivos fora da amostra sÃ£o identificados como
`sampled-out`; o Rust continua sem alterar o resultado produtivo em qualquer
estado.

O binÃ¡rio WASM real passou a integrar um teste de corpus no Vitest e na CI. A
mediÃ§Ã£o registra contrato, tempo, cÃ©lulas comparadas, cÃ©lulas divergentes e abas
divergentes. O avaliador agrega essas observaÃ§Ãµes, calcula taxa de divergÃªncia e
latÃªncia p95 e informa todos os motivos que impedem a promoÃ§Ã£o.

Os critÃ©rios padrÃ£o exigem contrato `3.0.0`, no mÃ­nimo 25 arquivos e 10.000
cÃ©lulas, zero falhas e divergÃªncias e p95 de atÃ© 1.500 ms. A fixture pÃºblica
isolada Ã© deliberadamente classificada como corpus insuficiente. Os critÃ©rios e
o processo de decisÃ£o estÃ£o documentados em `docs/WASM_PROMOTION_CRITERIA.md`.

## 16. Corpus reproduzÃ­vel e paridade estrutural â€” fase 6

O corpus WASM agora Ã© gerado de forma determinÃ­stica a partir de um manifesto
versionado. SÃ£o 25 arquivos XLSX e 13.200 cÃ©lulas cobrindo strings, nÃºmeros,
booleanos, fÃ³rmulas, datas nos sistemas 1900/1904, mesclagens e regiÃµes ocultas.
Os binÃ¡rios gerados nÃ£o sÃ£o versionados; a CI os recria e publica o relatÃ³rio de
mediÃ§Ã£o como artefato.

O inspetor OOXML TypeScript passou a preservar mesclagens, linhas ocultas e
colunas ocultas tambÃ©m no workbook de fallback. O shadow mode confronta essas
estruturas com o inventÃ¡rio Rust e reporta quantidades comparadas e divergentes.

Na mediÃ§Ã£o de referÃªncia, os 25 arquivos, 13.200 cÃ©lulas e 24 estruturas tiveram
paridade total, sem falhas ou divergÃªncias e com p95 abaixo do limite. O gate
permanece corretamente bloqueado: corpus sintÃ©tico comprova cobertura, mas a
promoÃ§Ã£o exige pelo menos cinco arquivos reais sanitizados por formato.

## 17. SanitizaÃ§Ã£o local do corpus real â€” fase 7

Foi adicionado um fluxo local e determinÃ­stico para transformar planilhas XLSX
reais em fixtures adequadas Ã  mediÃ§Ã£o de paridade sem versionar originais ou
cÃ³pias. Textos, nÃºmeros, datas, nomes de abas e literais de fÃ³rmula sÃ£o
pseudonimizados; metadados, links, comentÃ¡rios, nomes definidos, macros e
referÃªncias externas sÃ£o removidos ou neutralizados.

O sanitizador preserva os tipos das cÃ©lulas, fÃ³rmulas internas, formatos,
mesclagens e regiÃµes ocultas. Ele aceita somente XLSX, exige chave local via
ambiente, nÃ£o altera a origem e recusa destinos nÃ£o vazios. O manifesto gerado
nÃ£o contÃ©m nomes ou caminhos de origem nem a chave. Quando presente em
`test-fixtures/sanitized-real`, o corpus local passa a integrar automaticamente
o relatÃ³rio e o gate por formato; a CI continua usando apenas as fixtures
sintÃ©ticas reproduzÃ­veis.

## 18. Candidate mode com fallback automÃ¡tico â€” fase 8

Foi preparado o controle de ativaÃ§Ã£o gradual do Rust/WASM para XLSX. O padrÃ£o
continua sendo `shadow`, e a allowlist de formatos nasce vazia. Apenas a
combinaÃ§Ã£o explÃ­cita de `VITE_WASM_READER_MODE=candidate` com
`VITE_WASM_CANDIDATE_FORMATS=xlsx` permite que um match integral seja marcado
como `sheetjs-wasm-verified`.

Candidate mode mede 100% dos arquivos do formato liberado, independentemente da
taxa de shadow. Contrato incompatÃ­vel, divergÃªncia, falha do adaptador ou
indisponibilidade acionam fallback automÃ¡tico para o leitor TypeScript validado.
O relatÃ³rio registra modo, estado do candidato e motivo do fallback. O inventÃ¡rio
Rust ainda nÃ£o cria, substitui ou repara cÃ©lulas; publicar a allowlist continua
condicionado ao gate real sanitizado e a uma decisÃ£o humana por formato.

## 19. XLSX Rust/WASM primÃ¡rio com fallback validado â€” fase 9

O modo candidato e a allowlist `xlsx` passaram a ser os padrÃµes. O inventÃ¡rio
Rust agora Ã© materializado como workbook e percorre o pipeline real de
importaÃ§Ã£o. Sua saÃ­da sÃ³ Ã© usada quando cÃ©lulas, estruturas e o resultado final
sÃ£o idÃªnticos ao caminho TypeScript, sendo identificada como `rust-wasm`.

Filtros, tabelas, comentÃ¡rios e links jÃ¡ validados sÃ£o preservados na
materializaÃ§Ã£o. `VITE_WASM_READER_MODE=shadow` continua disponÃ­vel como rollback
imediato. O corpus real sanitizado ainda Ã© necessÃ¡rio antes de remover a
validaÃ§Ã£o dupla e obter ganho efetivo de desempenho.

## 20. Metadados OOXML independentes no candidato Rust â€” fase 10

O workbook materializado pelo inventÃ¡rio Rust deixou de copiar metadados do
workbook SheetJS. Filtros automÃ¡ticos, tabelas estruturadas, Pivot Tables,
comentÃ¡rios clÃ¡ssicos e hyperlinks internos ou externos agora sÃ£o reconstruÃ­dos
diretamente das partes e relacionamentos do pacote XLSX.

O leitor TypeScript continua executando como orÃ¡culo de paridade e fallback: a
saÃ­da Rust somente Ã© publicada quando o resultado final permanece idÃªntico. Isso
remove um acoplamento da materializaÃ§Ã£o sem antecipar a promoÃ§Ã£o independente,
que ainda depende de cinco arquivos XLSX reais sanitizados e do gate completo.

## 23. Duas falhas reais encontradas com planilhas de produÃ§Ã£o

Seis arquivos XLSX reais fornecidos pelo usuÃ¡rio (fora do repositÃ³rio, nunca
versionados) foram medidos com `measureWorkbookFidelity`. TrÃªs continham
apenas texto/nÃºmeros e jÃ¡ fechavam em 100% com zero divergÃªncias. Os outros
trÃªs â€” todos contendo imagens/logotipos â€” expuseram duas falhas que nenhum
teste sintÃ©tico havia coberto:

1. **`verifyWorkbookWithExcelJs` derrubava a mediÃ§Ã£o inteira.** ExcelJS tem
   bugs conhecidos ao carregar certos desenhos/Ã¢ncoras de imagem em XLSX real
   (`Cannot read properties of undefined (reading 'name')` e `(reading
'anchors')`, lanÃ§ados de dentro de `workbook.xlsx.load`). Como
   `measureWorkbookFidelity` nÃ£o capturava essa exceÃ§Ã£o, o relatÃ³rio inteiro
   quebrava â€” nenhuma pontuaÃ§Ã£o, nenhum diagnÃ³stico, sÃ³ um erro nÃ£o tratado.
   Corrigido isolando a chamada em `try/catch`: uma falha de leitor agora vira
   `failedReaders: ["ExcelJS"]`, um estado explÃ­cito e visÃ­vel, em vez de
   "0 divergÃªncias" silencioso ou um crash. Como nenhum cÃ³digo de produÃ§Ã£o usa
   `ExcelJS` no caminho de importaÃ§Ã£o (sÃ³ `fidelity-meter.ts` e testes), nÃ£o
   havia risco de regressÃ£o na UI, mas a mediÃ§Ã£o em si ficava inutilizÃ¡vel
   para esses arquivos.
2. **`ooxml-reader.ts` nÃ£o decodificava referÃªncias numÃ©ricas de caractere.**
   A funÃ§Ã£o `xmlText` sÃ³ tratava as cinco entidades nomeadas do XML (`&lt;`,
   `&gt;`, `&quot;`, `&apos;`, `&amp;`). ReferÃªncias numÃ©ricas vÃ¡lidas
   (`&#199;`, `&#xC7;`) â€” usadas por algumas ferramentas de exportaÃ§Ã£o para
   acentos â€” passavam intactas, produzindo texto corrompido como
   `SOLICITA&#199;&#213;ES` em vez de `SOLICITAÃ‡Ã•ES`. Isso gerava atÃ© 850
   avisos por arquivo real. Corrigido com decodificaÃ§Ã£o hex/decimal antes do
   `&amp;` final, preservando o caso em que `&amp;#38;` Ã© texto escapado de
   propÃ³sito (nÃ£o deve virar `&`).

Testes de regressÃ£o: `workbook-fidelity.test.ts` cobre a decodificaÃ§Ã£o
numÃ©rica com um pacote OOXML sintÃ©tico mÃ­nimo; `fidelity-meter-resilience.test.ts`
mocka `verifyWorkbookWithExcelJs` para lanÃ§ar e confirma que a mediÃ§Ã£o
continua, reportando `failedReaders` em vez de propagar a exceÃ§Ã£o.

Depois das duas correÃ§Ãµes, os seis arquivos reais fecham em 100%, zero
divergÃªncias de erro. As diferenÃ§as de `\n` vs `\r\n` entre leitores
continuam aparecendo como `warning` â€” representaÃ§Ã£o equivalente, nÃ£o erro,
consistente com a regra jÃ¡ registrada neste documento.

## 24. RepresentaÃ§Ã£o compacta de repetiÃ§Ãµes e sistema de datas do ODS

RevisÃ£o da fase 11 (seÃ§Ã£o 21) apontou dois problemas antes de o leitor ODS
poder integrar o shadow mode:

1. **Perda de fidelidade em cÃ©lulas/linhas repetidas.** A primeira versÃ£o
   materializava sÃ³ a primeira ocorrÃªncia de um bloco repetido e descartava
   o resto com um diagnÃ³stico de "truncagem". Isso fazia a dimensÃ£o real e
   a contagem de cÃ©lulas parecerem menores que a estrutura declarada â€” o
   prÃ³prio problema que a seÃ§Ã£o 23 corrige para outro leitor, agora
   corrigido aqui na origem. `CellInventory` ganhou os campos opcionais
   `repeatColumns`/`repeatRows` (contrato compartilhado com o XLSX, que
   nunca os emite): um Ãºnico registro representa um bloco retangular de
   cÃ©lulas idÃªnticas de forma compacta e sem perda, com `address` no canto
   superior esquerdo. `actualDimension` e a contagem de cÃ©lulas da aba
   passaram a somar a extensÃ£o lÃ³gica real do bloco, nÃ£o apenas a Ã¢ncora.
   O custo de processar um bloco continua O(1) por elemento do XML â€” nÃ£o Ã©
   um laÃ§o de materializaÃ§Ã£o, Ã© aritmÃ©tica sobre o tamanho declarado â€” e o
   limite de cÃ©lulas do pacote agora Ã© aplicado sobre essa extensÃ£o lÃ³gica.
   Os diagnÃ³sticos `ods-repeated-cell-truncated`/`ods-repeated-row-truncated`
   foram removidos por nÃ£o haver mais truncagem para relatar.
2. **`dateSystem` afirmava "1900" para um formato que nÃ£o usa esse
   conceito.** ODF grava data/hora como texto ISO 8601 direto; nÃ£o hÃ¡
   sÃ©rie numÃ©rica 1900/1904 a resolver. `DateSystem` ganhou a variante
   `NotApplicable` (JSON `"notApplicable"`), e o leitor ODS a emite em vez
   de um `Excel1900` que nunca Ã© interpretado. `parse_excel_serial` trata
   essa variante devolvendo "sem data" em vez de assumir uma convenÃ§Ã£o
   Excel â€” ela nunca Ã© chamada para ODS hoje, mas o comportamento fica
   seguro mesmo que isso mude.

`tests/ods_inventory.rs` foi atualizado: o teste de repetiÃ§Ã£o agora chama-se
`represents_repeated_cells_and_rows_compactly_without_loss` e confirma
`repeatColumns`/`repeatRows`, a dimensÃ£o real completa e a contagem lÃ³gica
de cÃ©lulas para um bloco de 5.000 colunas repetidas e uma linha repetida
10.000 vezes, sem descartar nada.

O leitor continua isolado do `workbook.worker`. Os itens restantes da
revisÃ£o â€” corpus real ODS sanitizado, e manter SheetJS como resultado
produtivo atÃ© paridade comprovada â€” seguem como prÃ©-condiÃ§Ã£o para
qualquer integraÃ§Ã£o em shadow mode, na mesma ordem recomendada.

## 25. Etapa 5 â€” auditoria de corpus de regressÃ£o e duas falhas reais

Antes de ampliar fixtures, uma auditoria comparou 20 cenÃ¡rios de leitura
universal contra a suÃ­te existente. Bem cobertos: cabeÃ§alho deslocado,
mÃºltiplas tabelas empilhadas/lado a lado, mesclagens, linhas/colunas
ocultas, cÃ©lulas de erro, delimitadores de CSV ambÃ­guos. Parciais: filtros
sem congelamento, fÃ³rmulas cacheadas vs. recalculadas, grandes planilhas
(sÃ³ o caminho de rejeiÃ§Ã£o), ZIP hostil (sÃ³ limites de dimensÃ£o/tamanho),
codificaÃ§Ã£o de CSV, ODS/XLS alÃ©m de um smoke test bÃ¡sico. Lacunas claras:
cabeÃ§alho repetido inline, sistema de datas 1904 no leitor OOXML
independente, shared strings rich text, imagens/grÃ¡ficos incorporados.

Escrever os testes das duas primeiras lacunas expÃ´s bugs reais, nÃ£o sÃ³
ausÃªncia de cobertura:

1. **`ooxml-reader.ts` nunca lia `workbookPr date1904`.** `serialDate`
   sempre assumia o sistema 1900 (`XLSX.SSF.parse_date_code` sem opÃ§Ãµes).
   Num arquivo de origem Mac (1904), qualquer data reconciliada por este
   leitor â€” usado na reparaÃ§Ã£o de abas/cÃ©lulas ausentes e como referÃªncia
   do shadow mode â€” saÃ­a ~4 anos errada, silenciosamente. Corrigido lendo
   `date1904` do `workbookPr` em `inspectOoxml` e propagando para
   `serialDate` e `XLSX.SSF.format` (que tambÃ©m precisa da opÃ§Ã£o para
   exibir a data certa). Teste em `workbook-fidelity.test.ts` confirma
   serial `1` virando `1900-01-01`/`"1/1/00"` sem a flag e
   `1904-01-02`/`"1/2/04"` com ela.
2. **RepetiÃ§Ã£o literal do cabeÃ§alho no meio dos dados virava um registro
   de dado.** RelatÃ³rios paginados/exportados costumam repetir a linha de
   cabeÃ§alho a cada quebra de pÃ¡gina, sem linha em branco nem tÃ­tulo
   separando um bloco novo â€” por isso a detecÃ§Ã£o de blocos empilhados (que
   jÃ¡ lida com um caso relacionado, mas diferente) nÃ£o pegava esse caso.
   `sheetToRows` agora filtra uma linha de dado que repete o cabeÃ§alho
   original em pelo menos duas colunas (exigÃªncia deliberada para nÃ£o
   descartar por engano um item de catÃ¡logo que sÃ³ coincide numa coluna),
   registra a contagem em `audit.repeatedHeaderRowsIgnored` e explica no
   aviso ao usuÃ¡rio, em vez de silenciosamente incluir
   `{"Nome": "Nome", "Valor": "Valor"}` como se fosse um registro.

A lacuna de shared strings rich text (mÃºltiplos `<r>` num `<si>`) jÃ¡
estava implementada corretamente (`sharedStrings` concatena todo `<t>`
dentro do `<si>`, dentro ou fora de `<r>`); ganhou um teste travando o
comportamento, sem precisar de correÃ§Ã£o. Imagens/grÃ¡ficos incorporados
continuam como lacuna registrada na seÃ§Ã£o 3, nÃ£o abordada nesta etapa.

TrÃªs lacunas adicionais foram fechadas com testes, todas confirmando
comportamento jÃ¡ correto (nenhuma correÃ§Ã£o necessÃ¡ria):

- **BOM UTF-8 em CSV** (`decodeText` jÃ¡ removia o marcador U+FEFF do
  inÃ­cio do texto decodificado): teste confirma que o nome da primeira
  coluna sai limpo, sem o BOM grudado.
- **ZIP hostil** (`validateZipWorkbook` jÃ¡ recusava contagem de entradas
  acima de `MAX_ZIP_ENTRIES` e razÃ£o de compressÃ£o suspeita acima de
  `MAX_SUSPICIOUS_COMPRESSION_RATIO`): dois testes constroem um registro
  EOCD/diretÃ³rio central hostil sem precisar de dados comprimidos reais
  (a checagem sÃ³ lÃª os campos declarados no cabeÃ§alho), confirmando a
  rejeiÃ§Ã£o de "arquivos internos demais" e de uma razÃ£o ~1 milhÃ£o:1
  caracterÃ­stica de zip bomb.
- **Planilha grande com sucesso**: sÃ³ existia o teste do caminho de
  rejeiÃ§Ã£o (dimensÃ£o declarada abusiva). Novo teste lÃª 5.000 linhas por 3
  colunas e confirma integridade da primeira e da Ãºltima linha.

## 26. Etapa 6 â€” leitor usado e fallback agora aparecem na interface

Uma auditoria de explicabilidade mapeou 11 itens do relatÃ³rio de leitura
contra o que jÃ¡ Ã© calculado e contra o que chega Ã  interface. A maioria jÃ¡
estava exposta (estrutura detectada, cabeÃ§alho escolhido e motivo,
regiÃµes/blocos encontrados, cÃ©lulas recuperadas, confianÃ§a por
regiÃ£o/coluna, aÃ§Ãµes conservadoras, sugestÃµes de revisÃ£o) â€” nenhuma delas
foi tocada. Dois itens computados por toda importaÃ§Ã£o nunca chegavam ao
usuÃ¡rio: qual leitor produziu o resultado (`WorkbookReadReport.reader`) e
se houve fallback do Rust para o TypeScript (`.fallbackUsed`). Essa
informaÃ§Ã£o de confianÃ§a existia sÃ³ no objeto de relatÃ³rio interno.

A lÃ³gica de descriÃ§Ã£o foi extraÃ­da para `describeReaderOutcome` em
`workbook-reading-engine.ts` (funÃ§Ã£o pura, sem estado), em vez de inline
no componente de rota â€” sÃ³ assim dÃ¡ para testar sem precisar simular
upload de arquivo num navegador de verdade, algo que a ferramenta de
automaÃ§Ã£o deste ambiente nÃ£o suporta (sÃ³ dispara eventos de mudanÃ§a em
`<input type="file">`, nÃ£o abre o diÃ¡logo do sistema operacional). A
funÃ§Ã£o sÃ³ produz mensagem nos estados informativos: o caminho comum
(`sheetjs-verified`, sem reparo, sem fallback) continua silencioso, sem
poluir toda importaÃ§Ã£o. `routes/index.tsx` chama essa funÃ§Ã£o e junta o
resultado Ã  mesma caixa de aviso jÃ¡ existente na revisÃ£o.

NÃ£o descoberto nenhum bug aqui â€” os dois campos jÃ¡ estavam corretos e
testados no motor; a lacuna era puramente de interface. Verificado com
`npx vitest run` (441 passou, 11 pulados, era 436), `npx tsc --noEmit` e
`npm run build`, mas **nÃ£o foi possÃ­vel verificar visualmente no
navegador**: a ferramenta de automaÃ§Ã£o deste sandbox nÃ£o consegue simular
o diÃ¡logo de seleÃ§Ã£o de arquivo do sistema operacional, e uma injeÃ§Ã£o via
`DataTransfer`/evento `change` sintÃ©tico nÃ£o foi concluÃ­da de forma
confiÃ¡vel. Risco considerado baixo: Ã© concatenaÃ§Ã£o de string reaproveitando
uma caixa de aviso jÃ¡ renderizada e testada, sobre campos jÃ¡ tipados e
cobertos por teste no motor de leitura â€” mas fica registrado como
verificaÃ§Ã£o pendente, nÃ£o como confirmado.

Itens da auditoria de explicabilidade da seÃ§Ã£o 26: a matriz de confianÃ§a
por aba foi implementada na seÃ§Ã£o 28, e regiÃµes descartadas e o motivo na
seÃ§Ã£o 29.

## 27. Etapa 3 â€” teste de rollback dedicado e documentaÃ§Ã£o do desligamento do candidato Rust

Fechava a lacuna registrada na seÃ§Ã£o 19: o modo candidato e a allowlist
`xlsx` jÃ¡ eram o padrÃ£o de produÃ§Ã£o, e `VITE_WASM_READER_MODE=shadow` jÃ¡
existia como variÃ¡vel de rollback, mas nÃ£o havia teste que provasse esse
comportamento isoladamente nem documentaÃ§Ã£o explÃ­cita do procedimento.

Nenhum bug foi encontrado â€” a lÃ³gica em `readWorkbookBytesWithEngine`
(`src/lib/workbook-reader.ts`) jÃ¡ garantia que a materializaÃ§Ã£o Rust sÃ³
ocorre dentro do bloco condicionado a `candidateEligible`, que por sua vez
exige `wasmReaderMode === "candidate"`. A lacuna era puramente de prova e
de documentaÃ§Ã£o:

- **Teste** (`src/lib/workbook-reader.test.ts`): registra o mesmo adaptador
  Rust simulado, com dados que dariam paridade total, e roda o mesmo
  arquivo duas vezes â€” uma em modo candidato (confirma promoÃ§Ã£o a
  `reader: "rust-wasm"`) e outra alterando somente `wasmReaderMode` para
  `"shadow"` (confirma reversÃ£o para `reader: "sheetjs-verified"`,
  `wasmOutputUsed: false`, linhas importadas idÃªnticas, e que a mediÃ§Ã£o de
  paridade continua ativa via `wasmShadowStatus: "matched"`). Isso prova
  que o Ãºnico parÃ¢metro que precisa mudar Ã© o modo, sem depender de
  desregistrar o adaptador ou reverter qualquer outro cÃ³digo.
- **DocumentaÃ§Ã£o** (`docs/WASM_PROMOTION_CRITERIA.md`, nova seÃ§Ã£o "Como
  desativar o candidato Rust (rollback)"): explicita que
  `VITE_WASM_READER_MODE` Ã© lido via `import.meta.env`, ou seja, Ã©
  substituÃ­do em **tempo de build** pelo Vite, nÃ£o Ã© um flag dinÃ¢mico de
  execuÃ§Ã£o. Isso corrige uma imprecisÃ£o do texto anterior ("rollback
  operacional Ã© imediato"): a mudanÃ§a de variÃ¡vel nÃ£o exige nenhuma
  alteraÃ§Ã£o de cÃ³digo, PR ou commit novo, mas ainda exige um novo
  build/deploy (na Vercel, basta redeploy do commit atual, sem novo
  commit) para que o valor embutido no bundle publicado mude.
  `.env.example` recebeu a mesma correÃ§Ã£o de forma resumida.

Verificado com `npx vitest run src/lib/workbook-reader.test.ts` (37 testes,
todos passando) e a suÃ­te completa (`npx vitest run`, 442 passou/11
pulados, era 441 â€” o novo teste soma um caso, sem alterar nenhum
prÃ©-existente, incluindo o teste de shadow mode genÃ©rico jÃ¡ registrado na
seÃ§Ã£o 26).

## 28. Matriz de confianÃ§a por aba

Fechava parte da lacuna registrada ao final da seÃ§Ã£o 26: "uma matriz de
confianÃ§a por aba/sheet (hoje sÃ³ hÃ¡ confianÃ§a global e por regiÃ£o/coluna)".

Como no caso do leitor/fallback da seÃ§Ã£o 26, nÃ£o havia bug nem lacuna de
cÃ¡lculo â€” `sheetsWithData` (`import.ts`) jÃ¡ roda `diagnoseImportedSheet`
para **toda** aba com dado no workbook, nÃ£o sÃ³ a aba ativa, entÃ£o
`SheetOption.diagnostics.confidence` e `.confidenceReasons` jÃ¡ existiam
para todas as abas simultaneamente. A lacuna era puramente de agregaÃ§Ã£o e
exibiÃ§Ã£o: nada juntava esses valores num lugar comparÃ¡vel lado a lado, e a
interface sÃ³ mostrava a confianÃ§a da aba selecionada no momento.

- **FunÃ§Ã£o pura nova**: `buildSheetConfidenceMatrix` em
  `import-intelligence.ts`, ao lado do tipo `ImportDiagnostics` que ela
  consome. Recebe `Array<{ name; diagnostics? }>` (compatÃ­vel
  estruturalmente com `SheetOption`, sem criar dependÃªncia circular com
  `import.ts`) e devolve, por aba: `confidence` (nÃºmero ou `null` quando
  nÃ£o hÃ¡ diagnÃ³stico), `level` (`"alta"` â‰¥85, `"mÃ©dia"` â‰¥60, `"baixa"`
  abaixo disso, ou `"sem diagnÃ³stico"`), os `reasons` jÃ¡ calculados e a
  contagem de divergÃªncias do leitor daquela aba especificamente. NÃ£o
  recalcula nada â€” sÃ³ lÃª e classifica o que jÃ¡ existe.
- **Interface**: a barra de abas da revisÃ£o (`routes/index.tsx`, dentro de
  `Review`) ganhou um indicador colorido por aba (verde/Ã¢mbar/vermelho,
  omitido quando nÃ£o hÃ¡ diagnÃ³stico) com `title` explicando o percentual e
  os motivos, sem alterar a navegaÃ§Ã£o entre abas nem nenhum cÃ¡lculo
  existente.

Testes em `import-intelligence.test.ts` (`describe("matriz de confianÃ§a por
aba")`) cobrem: classificaÃ§Ã£o alta/mÃ©dia/baixa a partir de diagnÃ³sticos
reais gerados por `diagnoseImportedSheet` (nÃ£o valores inventados), aba sem
diagnÃ³stico retornando `null`/`"sem diagnÃ³stico"` sem quebrar, e contagem de
divergÃªncias do leitor isolada por aba.

Verificado com `npx vitest run` (444 passou, 11 pulados, era 442 apÃ³s a
Etapa 3 da seÃ§Ã£o 27), `npx tsc --noEmit` sem erros e `npm run build`
aprovado. **NÃ£o foi possÃ­vel verificar
visualmente no navegador** â€” mesma limitaÃ§Ã£o jÃ¡ registrada na seÃ§Ã£o 26: a
ferramenta de automaÃ§Ã£o deste sandbox nÃ£o simula o diÃ¡logo de upload de
arquivo do sistema operacional, e o indicador sÃ³ aparece depois de importar
um workbook com mais de uma aba. Confirmado que a pÃ¡gina carrega sem erros
de console antes e depois da mudanÃ§a; a integraÃ§Ã£o em si Ã© composiÃ§Ã£o de
JSX sobre uma funÃ§Ã£o pura jÃ¡ testada, seguindo o mesmo padrÃ£o de risco
baixo da seÃ§Ã£o 26 â€” mas fica registrado como verificaÃ§Ã£o pendente, nÃ£o como
confirmado.

## 29. RegiÃµes independentes mantidas juntas por seguranÃ§a, agora auditadas

Fechava parte da lacuna registrada ao final da seÃ§Ã£o 26: "regiÃµes
descartadas e o motivo (nÃ£o existe nenhum modelo de dados para isso hoje,
nÃ£o Ã© sÃ³ falta de exibiÃ§Ã£o)".

`import-intelligence.ts` jÃ¡ detecta regiÃµes independentes por aba
(`ImportDiagnostics.tableRegions`), e `regionsAreSafeToSplit` (`import.ts`)
decide, com vÃ¡rios critÃ©rios de seguranÃ§a (matriz de identificadores +
perÃ­odos, cabeÃ§alho numÃ©rico, poucas linhas de dado, cobertura insuficiente
da Ã¡rea ocupada), se essas regiÃµes viram opÃ§Ãµes de importaÃ§Ã£o separadas.
Quando a resposta Ã© nÃ£o â€” o caso mais comum Ã© justamente o correto, uma
matriz de identificadores Ã  esquerda com colunas de perÃ­odo Ã  direita, que
`regionsAreSafeToSplit` recusa deliberadamente para nÃ£o quebrar a relaÃ§Ã£o
entre item e seus valores â€” a aba continuava importando como uma Ãºnica
tabela sem nenhum registro de que a separaÃ§Ã£o automÃ¡tica foi considerada e
recusada. `diagnostics.tableRegions` continuava existindo internamente, mas
nada da decisÃ£o chegava ao usuÃ¡rio nem Ã  auditoria.

Este recorte Ã© deliberadamente menor que "modelo de dados para regiÃµes
descartadas": em vez de decompor `regionsAreSafeToSplit` num motivo
nomeado por critÃ©rio de recusa (o que exigiria reescrever uma funÃ§Ã£o
delicada com muitos ramos de retorno antecipado, usada pelos testes jÃ¡
existentes de separaÃ§Ã£o de tabelas), a mudanÃ§a Ã© sÃ³ observabilidade â€”
registra que N regiÃµes foram detectadas e mantidas juntas, sem alterar
nenhuma decisÃ£o de separaÃ§Ã£o:

- `ImportAudit` (`import.ts`) ganha o campo opcional
  `regionsKeptTogether?: number`.
- `sheetsWithData` grava esse nÃºmero quando `diagnostics.tableRegions.length
  > 1` e a aba nÃ£o foi dividida acima (nem por `regionsAreSafeToSplit`, nem
  pela separaÃ§Ã£o por seÃ§Ãµes tituladas) â€” sem mudar a condiÃ§Ã£o de divisÃ£o em
  si, sÃ³ observando o resultado dela.
- A interface (`routes/index.tsx`, grade "BalanÃ§o verificÃ¡vel da
  importaÃ§Ã£o") ganha o item "RegiÃµes mantidas juntas", exibido apenas
  quando o valor Ã© maior que zero, no mesmo padrÃ£o dos outros contadores jÃ¡
  existentes.

Teste em `import.test.ts` estende o caso jÃ¡ existente "mantÃ©m
identificadores e perÃ­odos na mesma tabela quando hÃ¡ sÃ³ uma coluna de
respiro" (`regionsAreSafeToSplit` recusa por critÃ©rio temporal) para
confirmar `audit.regionsKeptTogether === diagnostics.tableRegions.length`
(2), e um novo teste confirma que uma aba com uma Ãºnica regiÃ£o nÃ£o recebe o
campo (`undefined`, nÃ£o `0` ou `1`).

O motivo especÃ­fico da recusa (qual dos vÃ¡rios critÃ©rios de
`regionsAreSafeToSplit` disparou) continua nÃ£o exposto â€” decompor essa
funÃ§Ã£o em motivos nomeados Ã© trabalho futuro maior, de maior risco de
regressÃ£o por tocar a lÃ³gica de separaÃ§Ã£o em si, nÃ£o sÃ³ observÃ¡-la.

Verificado com `npx vitest run` (445 passou, 11 pulados, era 444 apÃ³s as
etapas 27/28), `npx tsc --noEmit` sem erros e `npm run build` aprovado.
Assim como as seÃ§Ãµes 26 e anterior, **nÃ£o foi possÃ­vel verificar
visualmente no navegador** pela mesma limitaÃ§Ã£o de upload de arquivo do
sandbox; a mudanÃ§a Ã© sÃ³ leitura de dado jÃ¡ computado mais um item
condicional na grade de auditoria jÃ¡ renderizada e testada.

## 30. Etapa 4 â€” XLSM entra no corpus determinÃ­stico; XLTX/XLTM seguem sem mediÃ§Ã£o

Primeira avaliaÃ§Ã£o de propÃ³sito de outros formatos OOXML para promoÃ§Ã£o do
Rust (o roteiro original listava XLSM, XLTX, XLTM, XLS, CSV e ODS; esta
etapa cobre sÃ³ os trÃªs primeiros, os Ãºnicos que o adaptador Rust jÃ¡ tenta
em shadow mode hoje via `shouldTryWasm`).

- **XLSM**: `test-fixtures/wasm-corpus-manifest.json` ganhou quatro perfis
  (`baseline-xlsm`, `formulas-xlsm`, `structure-xlsm`,
  `date-system-1904-xlsm`), 25 arquivos e mais de 10.000 cÃ©lulas â€” mesmo
  volume de rigor jÃ¡ aplicado ao XLSX. `scripts/generate-workbook-corpus.mjs`
  nÃ£o precisou de nenhuma mudanÃ§a (SheetJS jÃ¡ escreve `bookType: "xlsm"`).
  MediÃ§Ã£o real: 1 dos 25 arquivos diverge em 12 cÃ©lulas, sempre a mesma
  causa determinÃ­stica â€” nÃºmeros "General" com dÃ­zima longa
  (`111.03999999999999`) sÃ£o exibidos pelo Rust como valor bruto em vez do
  arredondamento de exibiÃ§Ã£o do Excel/SheetJS (`111.04`); o valor bruto em
  si Ã© idÃªntico. NÃ£o Ã© um bug novo: Ã© a lacuna jÃ¡ registrada na seÃ§Ã£o 12
  ("exibiÃ§Ã£o conservadora... sem inventar a renderizaÃ§Ã£o de formatos Excel
  ainda nÃ£o implementados"), sÃ³ nunca antes exposta porque as sementes
  fixas do corpus XLSX original nÃ£o geravam esse padrÃ£o de ponto
  flutuante â€” o mesmo pode acontecer com XLSX real e nÃ£o foi corrigido
  aqui. Em produÃ§Ã£o isso nÃ£o corrompe dado: candidate mode trata qualquer
  `wasmShadowStatus === "diverged"` como fallback automÃ¡tico, sem tentar
  materializar a saÃ­da â€” a mediÃ§Ã£o confirma esse mecanismo funcionando
  como projetado, nÃ£o uma falha silenciosa. Detalhe completo em
  `docs/WASM_PROMOTION_CRITERIA.md`, seÃ§Ã£o "Outros formatos OOXML (Etapa
  4)".
- **XLTX e XLTM**: nÃ£o avaliados. O SheetJS instalado sÃ³ escreve
  `bookType` `"xlsx"`/`"xlsm"`; `XLSX.write({ bookType: "xltx" })` lanÃ§a
  `Unrecognized bookType |xltx|`. Sem gerador sintÃ©tico, e sem arquivos
  reais `.xltx`/`.xltm` disponÃ­veis, esses dois formatos continuam sem
  nenhuma mediÃ§Ã£o â€” nem sintÃ©tica, nem real. Isso Ã© a mesma categoria de
  bloqueio "arquivo real indisponÃ­vel" jÃ¡ registrada nas regras do
  projeto; nÃ£o inventado nem contornado.
- **XLS, CSV, ODS**: fora do escopo desta etapa. XLS (binÃ¡rio, nÃ£o
  ZIP/XML) e CSV (texto puro) nÃ£o tÃªm nenhum leitor Rust â€” nÃ£o Ã© uma
  questÃ£o de corpus, Ã© ausÃªncia de implementaÃ§Ã£o. ODS tem um leitor Rust
  isolado (`rust/oli-ooxml-core/src/ods.rs`, seÃ§Ã£o 21/24) mas nunca foi
  ligado ao `workbook.worker`/shadow mode; avaliÃ¡-lo para promoÃ§Ã£o exigiria
  primeiro essa integraÃ§Ã£o, que continua como prÃ©-condiÃ§Ã£o registrada nas
  seÃ§Ãµes 21/24, nÃ£o decidida nesta etapa.

Nenhuma allowlist de candidato mudou (`VITE_WASM_CANDIDATE_FORMATS`
continua sÃ³ `xlsx`); esta etapa Ã© sÃ³ mediÃ§Ã£o, sem promover nenhum formato
novo.

Testes em `wasm-shadow-corpus.test.ts` foram atualizados para o novo total
de 50 arquivos (25 xlsx + 25 xlsm) e para afirmar exatamente o resultado
real por formato (`divergentWorkbooks: 1`, `divergentCells: 12` para
xlsm) â€” deliberadamente nÃ£o zerado para nÃ£o esconder o achado, seguindo a
regra do projeto contra reduzir critÃ©rio para forÃ§ar verde.

Verificado com `npx vitest run` (445 passou, 11 pulados), `npx tsc
--noEmit` sem erros e `npm run build` aprovado.

## 31. Etapa 8 â€” bug real de chave duplicada no widget de ranking; auditoria de exportaÃ§Ã£o parcialmente bloqueada pelo ambiente

A ferramenta de "Colar dados"/"Ver demonstraÃ§Ã£o" contorna a limitaÃ§Ã£o de
upload de arquivo jÃ¡ registrada nas etapas anteriores: dÃ¡ para navegar atÃ©
um painel real com widgets renderizados e testar exportaÃ§Ã£o PNG/PDF de
ponta a ponta. Duas descobertas, uma corrigida e uma documentada como
bloqueio de ambiente.

**Bug real corrigido**: o widget "ranking" (`w.type === "ranking"`), em
modo `dataMode: "raw"` (linha a linha, sem agregar por grupo â€” o padrÃ£o
sugerido pelo dashboard automÃ¡tico), renderizava sua lista Top N com
`<li key={g.name}>` (`routes/index.tsx`), usando sÃ³ o nome da categoria
como chave React. Como o modo raw produz uma entrada por linha da
planilha, a mesma categoria (ex.: "Linha A", "ManhÃ£") aparece vÃ¡rias vezes
no Top N sempre que o mesmo grupo tiver os valores mais altos â€” um cenÃ¡rio
comum, nÃ£o um caso extremo. React avisava "Encontrado two children with
the same key" e "pode causar duplicaÃ§Ã£o ou omissÃ£o" dos itens
renderizados; capturado consistentemente no console do navegador com o
painel de demonstraÃ§Ã£o (`Ranking de Unidade/Turno por Resultado`).
Corrigido reaproveitando o campo `sourceRow` que `chartSeries()`
(`data-pipeline.ts`) jÃ¡ emite por linha em modo raw â€” mesmo padrÃ£o jÃ¡
usado para o grÃ¡fico de barras e de pizza (`entry.sourceRow ?? index`),
sÃ³ nunca aplicado a este widget: `key={`${g.name}-${g.sourceRow ?? i}`}`.

Como o widget-porta de exportaÃ§Ã£o PNG/PDF captura o DOM renderizado via
`html2canvas`, uma renderizaÃ§Ã£o com itens duplicados/omitidos por chave
colidida afetaria tambÃ©m o conteÃºdo exportado, nÃ£o sÃ³ a tela ao vivo â€”
por isso esse achado entra no escopo da Etapa 8, mesmo sendo um bug de
renderizaÃ§Ã£o geral, nÃ£o especÃ­fico do mÃ³dulo de exportaÃ§Ã£o.

**TambÃ©m ajustado, sem confirmaÃ§Ã£o completa**: quatro usos de
`dot`/`activeDot` do Recharts (grÃ¡ficos de Ã¡rea e linha) passavam
`{...dotProps}` diretamente para `<ChartDot>`, incluindo silenciosamente
o campo `key` que o Recharts injeta no objeto de props â€” o antipadrÃ£o que
o prÃ³prio React avisa ("A props object containing a 'key' prop is being
spread into JSX"), porque `key` espalhado via `{...props}` nÃ£o Ã© lido
corretamente pelo React como identificador de lista. Corrigido
desestruturando `key` explicitamente e passando como atributo JSX direto
(`key={key}`), o padrÃ£o oficialmente recomendado. **Esse aviso especÃ­fico
continuou aparecendo no console mesmo depois da correÃ§Ã£o** â€” indÃ­cio de
que o Recharts, internamente, tambÃ©m manipula/clona esses elementos com
seu prÃ³prio `key`, fora do controle direto do cÃ³digo da aplicaÃ§Ã£o. A
mudanÃ§a Ã© mantida por seguir a prÃ¡tica correta e nÃ£o ter nenhum efeito
colateral negativo, mas fica registrado que nÃ£o eliminou o aviso.

**Bloqueio de ambiente descoberto**: `document.hidden` Ã© `true` e
`document.visibilityState` Ã© `"hidden"` neste sandbox â€” o painel do
navegador nÃ£o compÃµe frames (mesma causa raiz jÃ¡ documentada para
`computer{action:"screenshot"}`). Como consequÃªncia, `requestAnimationFrame`
nunca dispara neste ambiente, o que trava indefinidamente qualquer cÃ³digo
que dependa dele: o contador animado dos KPIs (`AnimatedNumber`,
`routes/index.tsx`) fica congelado em "0", e `settleExportLayout()`
(`dashboard-export.ts`, que usa duas chamadas de RAF) nunca resolve,
deixando a classe `oliam-export-mode` presa no DOM porque o `finally` da
captura nunca Ã© alcanÃ§ado. Confirmado que isso Ã© puramente um artefato
deste sandbox â€” nÃ£o um bug do produto â€” aplicando um polyfill temporÃ¡rio
de `requestAnimationFrame` (via `setTimeout`) sÃ³ para inspeÃ§Ã£o: com o RAF
funcionando, a exportaÃ§Ã£o PNG completa normalmente e a classe Ã© removida
corretamente. ConsequÃªncia prÃ¡tica: nÃ£o foi possÃ­vel auditar visualmente
o conteÃºdo exportado (textos longos, tabelas largas, modo escuro,
acentos, layout A4) neste ambiente â€” os downloads nÃ£o sÃ£o inspecionÃ¡veis
e capturas de tela nÃ£o funcionam com o painel oculto. Essa auditoria
visual completa da Etapa 8 continua pendente e exigiria um navegador real
e visÃ­vel (ex.: preview da Vercel testado manualmente).

Verificado com `npx vitest run` (445 passou, 11 pulados, mesma contagem â€”
correÃ§Ã£o de JSX sem cobertura de teste de componente disponÃ­vel no
projeto, que nÃ£o usa `@testing-library/react`), `npx tsc --noEmit` sem
erros, `npm run build` aprovado e reproduÃ§Ã£o/correÃ§Ã£o confirmada
manualmente no navegador via console (antes: aviso presente a cada
carregamento do painel de demonstraÃ§Ã£o; depois: aviso do ranking
desaparece, aviso do ChartDot persiste pelo motivo explicado acima).

## 32. Etapa 9 â€” responsividade mobile: sÃ³lida no essencial, alvos de toque abaixo do recomendado

Auditoria do painel real (via "Ver demonstraÃ§Ã£o") em viewport 375Ã—812
(preset mobile), usando `resize_window` e inspeÃ§Ã£o via `javascript_tool`
em vez de captura de tela â€” a limitaÃ§Ã£o de compositaÃ§Ã£o de frames deste
sandbox (seÃ§Ã£o anterior) tambÃ©m impede `computer{action:"screenshot"}`,
mas nÃ£o impede leitura de layout computado via DOM/CSSOM, que nÃ£o depende
de pintura real.

**Funciona corretamente:**

- Sem overflow horizontal acidental na pÃ¡gina: `document.documentElement
  .scrollWidth === window.innerWidth` mesmo com 13 widgets carregados.
- Grade de widgets usa `grid-cols-1` em mobile e `lg:grid-cols-3` a partir
  do breakpoint largo â€” empilhamento de coluna Ãºnica correto.
- GrÃ¡ficos largos e a tabela detalhada (`Base detalhada`) rolam
  horizontalmente **dentro do prÃ³prio contÃªiner** (`overflow-x-auto`,
  classe `oliam-chart-drag-scroll`/`oliam-data-table`), sem vazar para a
  pÃ¡gina â€” padrÃ£o jÃ¡ comunicado ao usuÃ¡rio via "use as setas, arraste ou
  role para os lados".
- A barra lateral (`.oliam-sidebar`) Ã© `position: fixed` com
  `left: -260px` por padrÃ£o em mobile (fora da tela) e desliza para
  `left: 0` ao alternar â€” padrÃ£o de gaveta (drawer) funcional, nÃ£o
  empurra o conteÃºdo.
- O painel de insights (`.oliam-insight-sidebar`, "VisÃ£o geral") usa
  `hidden lg:block` â€” corretamente ausente em mobile em vez de
  espremido.

**Achado real, nÃ£o corrigido nesta etapa:** os botÃµes de gerenciamento de
widget (copiar, colar, mover para trÃ¡s/frente, remover â€” ex.: aria-label
"Copiar Resultado") sÃ£o fixados em `size-7` (28Ã—28px do Tailwind), sem
nenhuma variante responsiva (`sm:size-9` ou equivalente) para aumentar o
alvo de toque em telas estreitas. 28px estÃ¡ abaixo dos ~44px recomendados
pelas diretrizes de acessibilidade mÃ³vel (Apple HIG/Material Design), e
esses botÃµes ficam agrupados lado a lado (5 por widget), aumentando o
risco de toque errado num dispositivo real. Confirmado que os botÃµes
estÃ£o sempre visÃ­veis e clicÃ¡veis (`opacity: 1`, `pointer-events: auto`,
nÃ£o dependem de hover) â€” o problema Ã© sÃ³ o tamanho do alvo, nÃ£o
visibilidade. NÃ£o corrigido nesta etapa porque Ã© um padrÃ£o de design
compartilhado por toda a interface (nÃ£o um widget isolado); mudar o
tamanho de Ã­cone globalmente exige verificaÃ§Ã£o visual em vÃ¡rias telas que
este sandbox nÃ£o consegue fazer (sem captura de tela funcional). Fica
registrado como recomendaÃ§Ã£o para uma etapa dedicada, com verificaÃ§Ã£o
visual num navegador real.

## 33. Etapa 10 â€” auditoria semÃ¢ntica dos widgets: sistema jÃ¡ maduro, nenhum bug novo encontrado

RevisÃ£o da coerÃªncia entre operaÃ§Ã£o de agregaÃ§Ã£o oferecida e o papel
semÃ¢ntico da coluna (`semanticAggregationOps`, `relevantAggregationOps`
em `data-pipeline.ts`), aplicada a partir de `routes/index.tsx` nos seis
tipos de widget que agregam (`metric-trend`, `bar`, `pie`, `line`,
`area`, `ranking`, `pivot-table`/`matrix-heatmap`).

Verificado, sem bug encontrado:

- `semanticAggregationOps` jÃ¡ remove soma/multiplicaÃ§Ã£o/divisÃ£o de
  colunas nÃ£o aditivas (percentuais, resultados, metas, notas, mÃ©dias,
  temperatura, concentraÃ§Ã£o â€” por papel semÃ¢ntico, famÃ­lia de unidade ou
  nome da coluna via regex), mantendo mÃ©dias/contagem/faixa. JÃ¡ coberto
  por `describe("semanticAggregationOps", â€¦)` em `data-pipeline.test.ts`.
- `relevantAggregationOps` jÃ¡ evita oferecer 7 operaÃ§Ãµes equivalentes
  quando os dados nÃ£o sustentam a distinÃ§Ã£o (ex.: uma aba jÃ¡ prÃ©-agregada
  com uma linha por grupo) â€” reduz para as operaÃ§Ãµes que realmente mudam
  o resultado.
- `numericKinds` (`number`/`currency`/`percentage`) e `groupableKinds`
  (`category`/`text`/`date`) sÃ£o aplicados de forma consistente: nenhuma
  coluna de texto/categoria aparece como mÃ©trica somÃ¡vel, nenhuma coluna
  numÃ©rica aparece como dimensÃ£o de agrupamento por padrÃ£o.
- GrÃ¡fico de pizza sÃ³ Ã© sugerido automaticamente pelo dashboard
  automÃ¡tico (`auto-dashboard.ts`) quando a cardinalidade da dimensÃ£o
  estÃ¡ entre 2 e 8 categorias â€” evita pizzas ilegÃ­veis com dezenas de
  fatias; cardinalidade alta gera aviso explÃ­cito em vez de sugestÃ£o
  silenciosa.
- Os quatro tipos de grÃ¡fico (`bar`, `pie`, `line`, `area`) compartilham
  o mesmo bloco de cÃ³digo e a mesma chamada de `semanticAggregationOps` â€”
  nÃ£o hÃ¡ caminho onde um tipo aplica o filtro semÃ¢ntico e outro nÃ£o.

Nenhuma mudanÃ§a de cÃ³digo nesta seÃ§Ã£o â€” Ã© uma auditoria de confirmaÃ§Ã£o,
nÃ£o uma correÃ§Ã£o. Fica registrado como base de referÃªncia: se um bug
semÃ¢ntico for reportado no futuro (operaÃ§Ã£o nonsensical oferecida para
uma coluna), o ponto de partida Ã© `semanticAggregationOps`/
`relevantAggregationOps`, jÃ¡ testados e jÃ¡ aplicados de forma uniforme â€”
o bug mais provÃ¡vel estaria na *classificaÃ§Ã£o* da coluna (perfil
semÃ¢ntico incorreto vindo de `spreadsheet-intelligence.ts`), nÃ£o na
lÃ³gica de filtragem de operaÃ§Ãµes em si.

## 34. Alvos de toque dos botÃµes de widget aumentados sÃ³ em dispositivos de toque

Corrige o achado registrado na seÃ§Ã£o 32: os cinco botÃµes de gerenciamento
de widget (copiar, colar, mover para trÃ¡s/frente, remover â€” componente
`WidgetHead` em `routes/index.tsx`) eram fixados em `size-7` (28Ã—28px do
Tailwind) em qualquer dispositivo, abaixo dos ~44px recomendados para
alvos de toque.

CorreÃ§Ã£o usando a media feature CSS `pointer: coarse` (variante nativa do
Tailwind v4, `pointer-coarse:`), que distingue o tipo de ponteiro
primÃ¡rio do dispositivo â€” coarse para toque, fine para mouse/trackpad â€”
em vez de um breakpoint de largura, que erraria tanto para uma janela
desktop estreita quanto para um tablet grande com mouse conectado:

- BotÃµes passam de `size-7` para `pointer-coarse:size-9` (28px â†’ 36px em
  toque; mouse/trackpad continuam em 28px, zero mudanÃ§a visual em
  desktop).
- O espaÃ§amento entre os botÃµes cresce de `gap-0.5` para
  `pointer-coarse:gap-1`.
- O cabeÃ§alho do widget (`h-12` fixo, 48px) ganha
  `pointer-coarse:h-auto pointer-coarse:min-h-12` porque o crescimento
  dos botÃµes, em tÃ­tulos mais longos (ex.: "Resultado por linha de
  Turno"), empurra o grupo de botÃµes para quebrar numa segunda linha
  (`flex-wrap` jÃ¡ existente no contÃªiner) â€” sem essa mudanÃ§a, a altura
  fixa cortava a segunda linha. Em desktop essa quebra nunca ocorre (os
  botÃµes continuam pequenos o suficiente para caber numa linha sÃ³), entÃ£o
  a altura automÃ¡tica nÃ£o tem efeito lÃ¡.

Verificado manualmente no navegador redimensionando para 375Ã—812 (preset
mobile deste sandbox emula corretamente `pointer: coarse` â€” confirmado
via `matchMedia`, ao contrÃ¡rio da limitaÃ§Ã£o de composiÃ§Ã£o de frames que
bloqueia `requestAnimationFrame`/screenshot): botÃµes em 36Ã—36px, nenhum
cabeÃ§alho de widget com `scrollHeight > clientHeight` (sem corte) entre os
13 widgets do painel de demonstraÃ§Ã£o, incluindo os 10 com tÃ­tulo longo o
suficiente para quebrar linha. Em desktop, confirmado que os botÃµes
permanecem em 28Ã—28px e a altura do cabeÃ§alho em 48px, idÃªntico ao
comportamento anterior Ã  mudanÃ§a.

Verificado com `npx vitest run` (445 passou, 11 pulados, sem mudanÃ§a â€”
CSS/JSX sem cobertura de teste de componente disponÃ­vel), `npx tsc
--noEmit` sem erros e `npm run build` aprovado.

## 35. CorreÃ§Ã£o do formato "General" no Rust â€” divergÃªncia do corpus XLSM eliminada

Corrige o gap identificado nas seÃ§Ãµes 12 e 30: `display_cell_value`
(`rust/oli-ooxml-core/src/lib.rs`) sÃ³ arredondava formatos numÃ©ricos
explÃ­citos (`0`, `0.00`, `0%`, `0.00%`); fora deles, caÃ­a em
`value.to_string()`, expondo ruÃ­do de ponto flutuante binÃ¡rio que o
Excel/SheetJS arredondam para exibiÃ§Ã£o (`111.03999999999999` em vez de
`111.04`). O valor bruto (`rawValue`) do contrato nunca foi afetado â€” sÃ³
a representaÃ§Ã£o textual estava errada.

- `format_general_number()`: arredonda a 11 dÃ­gitos significativos, a
  mesma convenÃ§Ã£o documentada do Excel para o formato "General" (Excel
  guarda mais precisÃ£o internamente, mas limita a exibiÃ§Ã£o em "General"
  a 11 dÃ­gitos), depois remove zeros Ã  direita e o ponto decimal
  sobrando. Testado com o ruÃ­do binÃ¡rio real do corpus, inteiros,
  decimais simples, negativos, o limite de 11 dÃ­gitos e o caminho
  completo via `display_cell_value`.
- `Cargo.toml`: `0.4.0` â†’ `0.4.1` (correÃ§Ã£o de comportamento; o
  contrato JSON `3.0.0` nÃ£o muda â€” mesmo formato de saÃ­da, sÃ³ o valor
  textual de cÃ©lulas "General" com muitas casas decimais muda).

**Processo de validaÃ§Ã£o, dado que este sandbox nÃ£o linka nem roda
`cargo test` de verdade (seÃ§Ã£o "Armadilhas de ambiente" do prompt desta
sessÃ£o):**

1. MatemÃ¡tica de arredondamento cross-validada em Node.js antes de
   escrever os testes Rust (mesma fÃ³rmula, mesmos casos de teste).
2. `cargo fmt --check` e `cargo clippy` via toolchain `gnullvm` local:
   valida tipos e lints, sem rodar os testes de verdade.
3. Disparado `.github/workflows/wasm-build.yml` manualmente
   (`gh workflow run wasm-build.yml --ref fix-rust-general-format`) â€”
   esse workflow builda em Ubuntu e roda `cargo test --locked` de
   verdade como um dos passos. **Passou** (`Test Rust core âœ“`),
   confirmando os testes unitÃ¡rios novos (incluindo o caso do ruÃ­do
   binÃ¡rio real) executados de fato, nÃ£o sÃ³ compilados.
4. Artefato `oli-ooxml-core-wasm` baixado da execuÃ§Ã£o da CI e usado
   para substituir `src/wasm/oli-ooxml-core/` localmente.
5. `npm run wasm:corpus` re-executado com o binÃ¡rio corrigido: o XLSM
   que antes divergia em 1/25 arquivos e 12 cÃ©lulas agora fecha em
   **zero divergÃªncias** (`divergentWorkbooks: 0`, `divergentCells: 0`),
   confirmando a correÃ§Ã£o contra o mesmo corpus que expÃ´s o bug.
   `wasm-shadow-corpus.test.ts` atualizado para afirmar o resultado
   limpo. O gate de promoÃ§Ã£o do XLSM continua bloqueado pelo motivo jÃ¡
   conhecido (corpus real sanitizado insuficiente, 0/5), nÃ£o mais por
   divergÃªncia.

O binÃ¡rio WASM reconstruÃ­do (`src/wasm/oli-ooxml-core/`) Ã© commitado
junto com a mudanÃ§a de fonte, seguindo o mesmo processo jÃ¡ documentado
em `WASM_PROMOTION_CRITERIA.md`/seÃ§Ã£o 14: o pacote web Ã© versionado
porque `wasm-pack` nÃ£o funciona de forma confiÃ¡vel em todo ambiente
local (incluindo este sandbox).

Verificado com `npx vitest run` (445 passou, 11 pulados, mesma
contagem â€” sÃ³ a asserÃ§Ã£o de um teste existente mudou, refletindo o
resultado real e nÃ£o mais o bug), `npx tsc --noEmit` sem erros e
`npm run build` aprovado.

## 36. Quebra estrutural de `routes/index.tsx` (10.282 â†’ 3.715 linhas)

Prioridade "MÃ©dia" do roteiro de melhorias: `src/routes/index.tsx` tinha
10.282 linhas (429 KB) e concentrava o fluxo de importaÃ§Ã£o/revisÃ£o, a
orquestraÃ§Ã£o do painel e o editor de widgets num Ãºnico arquivo â€” a
maior fonte de risco de regressÃ£o do projeto (seÃ§Ã£o 5, item 1 deste
documento). Nenhuma linha de comportamento foi alterada nesta etapa;
Ã© reorganizaÃ§Ã£o estrutural pura, verificada a cada corte com a suÃ­te
completa.

**Mapeamento prÃ©vio** (via agente de exploraÃ§Ã£o, sem editar nada):
identificou clusters por responsabilidade e ordem de extraÃ§Ã£o por
risco crescente â€” componentes-folha sem estado compartilhado primeiro,
depois o fluxo de importaÃ§Ã£o/revisÃ£o (prop-driven), depois as peÃ§as de
suporte de widget e o prÃ³prio `WidgetCard` (o maior bloco, ~3.060
linhas, mas tambÃ©m prop-driven e sem closures sobre o estado de
`Dashboard`), deixando `Dashboard` (~2.500 linhas, dezenas de
`useState` locais) e `OliAm` (a raiz de orquestraÃ§Ã£o) para uma etapa
futura dedicada â€” extrair `Dashboard` exigiria primeiro consolidar seu
estado (ex.: um reducer), risco maior que mover cÃ³digo jÃ¡ isolado.

**TÃ©cnica de extraÃ§Ã£o**: para os dois primeiros cortes (componentes-
folha e fluxo de importaÃ§Ã£o/revisÃ£o, juntos ~1.780 linhas), o cÃ³digo foi
lido e reescrito diretamente. A partir do corte de `WidgetCard` (~3.060
linhas sozinho), a tÃ©cnica mudou para reduzir risco de erro de
transcriÃ§Ã£o num bloco desse tamanho: `sed` corta o intervalo de linhas
exato do componente (sem retranscriÃ§Ã£o manual do JSX), e um script Node
(`gen-imports.mjs`, descartÃ¡vel, nÃ£o commitado) cruza cada identificador
do bloco de import original de `index.tsx` com o uso real no corpo
extraÃ­do, gerando a lista de imports do novo arquivo por interseÃ§Ã£o â€”
em vez de "o que pode ser necessÃ¡rio", Ã© "o que o texto realmente usa".
Isso pega tanto import faltando quanto import morto automaticamente.
Falsos positivos do script (identificador citado sÃ³ em comentÃ¡rio, ex.:
`useTheme`, `X`, `toggleClickFilter`) foram confirmados manualmente
antes de descartar; o sinal mais forte de correÃ§Ã£o, porÃ©m, foi rodar
`npx tsc --noEmit` logo apÃ³s montar cada arquivo â€” import faltando vira
erro de tipo imediato, e o projeto desliga
`@typescript-eslint/no-unused-vars` (`eslint.config.*`), entÃ£o import
sobrando nÃ£o quebra lint, sÃ³ fica como limpeza de legibilidade
(feita Ã  parte, com outro script que compara cada nome importado contra
o uso no restante do arquivo).

**Arquivos criados** em `src/components/oliam/`:

- Componentes-folha: `mark.tsx`, `oli-loader.tsx`, `oli-welcome-scene.tsx`,
  `oli-face.tsx`, `theme-toggle.tsx`, `animated-number.tsx`,
  `onboarding.tsx`, `sheet-picker-dialog.tsx`, `gemini-chat-panel.tsx`.
- Fluxo de importaÃ§Ã£o/revisÃ£o: `home.tsx`, `empty.tsx`,
  `import-workbench.tsx`, `review.tsx` (este Ãºltimo importa
  `ImportWorkbench` e renderiza a matriz de confianÃ§a por aba da
  seÃ§Ã£o 28).
- Editor de widget: `widget-support.tsx` (peÃ§as compartilhadas entre
  `Dashboard` e `WidgetCard` â€” `FieldDropSlot`, `WidgetHead`,
  `WidgetPickerIcon`, tooltips/eixos de grÃ¡fico, `CalculationButton`,
  `PieLegend`, `MapWidgetBody`, `ChartDot` â€” tudo exportado porque
  ambos os consumidores precisavam), `widget-card.tsx` (`WidgetCard` +
  `EmptyWidget`, Ãºnico consumidor de `widget-support.tsx` que sobrou em
  `index.tsx`), `format-rules-editor.tsx`.

`index.tsx` hoje contÃ©m sÃ³ `OliAm` (orquestraÃ§Ã£o de rota/estÃ¡gio) e
`Dashboard` (o maior estado local restante).

**RegressÃ£o real de bundle, encontrada e corrigida antes do commit
final**: depois do corte de `WidgetCard`, `npm run performance:check`
acusou um chunk `format-rules-editor-*.js` de 961,1 KiB â€” mais que o
dobro do limite de 420 KiB por chunk genÃ©rico. Isolado comparando o
build desta branch contra `main` sem nenhuma mudanÃ§a de cÃ³digo (branch
trocada com os dois arquivos novos, ainda nÃ£o commitados, temporariamente
fora de `src/` para nÃ£o contaminar o build de `main`): `main` fecha em
295 KiB no maior chunk genÃ©rico compartilhado entre as rotas `/` e
`/painel/$id`; a mesma quantidade de cÃ³digo, sÃ³ reorganizada em mais
arquivos sem alterar o grafo de mÃ³dulos em si, faz o bundler (Rolldown,
via Vite) escolher um "mÃ³dulo fachada" diferente para nomear esse
mesmo chunk compartilhado â€” e, ao fazer isso, consolida `recharts`
inteiro e vÃ¡rios pacotes `@radix-ui`/`@floating-ui`/`cmdk`/`sonner`
dentro dele, que antes ficavam distribuÃ­dos entre os chunks de rota.
Nada foi duplicado nem ficou maior em bytes totais (o total de JS do
build atÃ© caiu, de 3,6 MB para 3,4 MB, por deduplicaÃ§Ã£o real de cÃ³digo
antes espalhado por trÃªs chunks de rota) â€” o problema Ã© puramente de
qual *um* chunk concentra esse peso.

Corrigido com `manualChunks` explÃ­cito em `vite.config.ts`, isolando
`recharts`/`d3-*` num chunk `recharts-vendor` (407 KiB) e
`@radix-ui`/`@floating-ui`/`cmdk`/`sonner` num chunk `radix-vendor`
(154 KiB), sem introduzir nenhum carregamento tardio novo â€” Ã© sÃ³
reorganizaÃ§Ã£o de chunk de vendor. O carregamento sob demanda jÃ¡
existente (Leaflet, xlsx, jsPDF, html2canvas) nÃ£o foi tocado e continua
funcionando como antes. Resultado final: maior chunk genÃ©rico
`format-rules-editor-*.js` em 400,4 KiB, dentro do limite de 420 KiB.

**LiÃ§Ã£o registrada para o futuro**: mover cÃ³digo entre arquivos sem
mudar o que ele faz *pode* ainda assim quebrar o orÃ§amento de bundle,
porque o nome/composiÃ§Ã£o de um chunk compartilhado depende de detalhes
internos do bundler sensÃ­veis Ã  estrutura de arquivos, nÃ£o sÃ³ ao grafo
de dependÃªncias lÃ³gico. `npm run performance:check` precisa rodar
depois de qualquer reorganizaÃ§Ã£o de arquivos que mova cÃ³digo
significativo entre mÃ³dulos, nÃ£o sÃ³ depois de mudanÃ§as de
comportamento.

Verificado a cada um dos quatro commits desta refatoraÃ§Ã£o com
`npx vitest run` (445 passou, 11 pulados, contagem idÃªntica em todos â€”
nenhum teste foi criado, modificado ou removido, confirmando que
nenhum comportamento mudou), `npx tsc --noEmit` sem erros, `npm run
build` aprovado, e `npm run performance:check` aprovado no commit
final (400,4 KiB no maior chunk genÃ©rico, abaixo do limite de 420 KiB).

## 37. MÃ©tricas reais de importaÃ§Ã£o (sem dado de planilha)

Fecha parte da lacuna registrada na seÃ§Ã£o 6 ("MÃ©tricas que ainda
precisam ser registradas por importaÃ§Ã£o"): tempo por leitor jÃ¡ existia
por importaÃ§Ã£o em `WorkbookReadReport` (`workbook-reading-engine.ts`),
mas nunca era persistido nem agregado entre importaÃ§Ãµes â€” cada
relatÃ³rio vivia e morria dentro de uma Ãºnica chamada, sem histÃ³rico
para responder "o candidato Rust/WASM estÃ¡ ajudando ou sÃ³ custando
mais caro, ao longo do tempo?".

**Bytes compactados/expandidos, novo no relatÃ³rio**: `validateZipWorkbook`
(`workbook-reader.ts`) jÃ¡ calculava `totalUncompressed` para aplicar o
limite de seguranÃ§a pÃ³s-descompactaÃ§Ã£o, mas descartava o valor.
Passou a retornar `{ totalUncompressedBytes }`; `readWorkbookBytesWithEngine`
grava isso em dois campos novos de `WorkbookReadReport`: `sourceBytes`
(tamanho do arquivo como recebido) e `expandedBytes` (soma declarada no
diretÃ³rio central do ZIP; igual a `sourceBytes` para CSV/TXT, que nÃ£o
tem camada de compressÃ£o). Importante: `expandedBytes` nÃ£o Ã©
necessariamente maior que `sourceBytes` para arquivos pequenos â€” o
contÃªiner ZIP tem overhead estrutural por entrada (cabeÃ§alhos locais,
diretÃ³rio central, ~30-70 bytes cada) que nÃ£o entra nessa soma, entÃ£o
um XLSX minÃºsculo com muitas partes internas pequenas pode ter
`sourceBytes` maior. O teste de regressÃ£o usa o valor exato calculado
por `validateZipWorkbook`, nÃ£o uma comparaÃ§Ã£o de maior/menor.

**Novo mÃ³dulo `src/lib/import-metrics.ts`**: constrÃ³i uma
`ImportMetricEntry` a partir de um `WorkbookReadReport` bem-sucedido
(`buildImportMetricEntry`) ou de um erro capturado
(`buildFailedImportMetricEntry`) â€” nunca a partir de linhas/cÃ©lulas da
planilha. Mensagens de erro sÃ£o truncadas a 200 caracteres por
seguranÃ§a, mas na prÃ¡tica todas as mensagens lanÃ§adas pelo pipeline de
leitura sÃ£o estÃ¡ticas (auditado: nenhuma interpola nome de arquivo ou
conteÃºdo de cÃ©lula, sÃ³ constantes de limite como "mais de 100 abas").
`recordImportMetric` acumula no IndexedDB local (via
`storage.ts`, mesmo idioma de `loadGeocodeCache`/`saveGeocodeCache`),
mantendo sÃ³ as Ãºltimas 200 entradas, e respeita modo privado (grava sÃ³
em `sessionStorage`, some ao fechar a aba â€” `setPrivateMode(false)`
jÃ¡ limpa essa chave junto com `PRIVATE_DASH_KEY`).
`summarizeImportMetrics` agrega por leitor (contagem, tempo mÃ©dio),
taxa de fallback e estados do shadow mode WASM (`matched`/`diverged`/
`failed`) â€” a agregaÃ§Ã£o pensada especificamente para a pergunta "o
WASM ajuda ou sÃ³ custa" citada acima; ainda sem consumidor de UI (fica
para uma etapa futura, um pequeno painel de diagnÃ³stico).

**Ponto de gravaÃ§Ã£o Ãºnico**: `readWorkbook` em `routes/index.tsx`
(usado tanto pela importaÃ§Ã£o principal quanto pela ressincronizaÃ§Ã£o de
pasta monitorada) grava a mÃ©trica de sucesso logo apÃ³s
`readWorkbookFileWithReport` retornar, e a mÃ©trica de falha no
`catch`, antes de relanÃ§ar o erro para o tratamento existente (que
continua intacto â€” a gravaÃ§Ã£o de mÃ©trica nÃ£o muda nenhuma mensagem de
erro exibida ao usuÃ¡rio). Cancelamento pelo usuÃ¡rio
(`DOMException`/`AbortError`, ex.: botÃ£o "Cancelar importaÃ§Ã£o") Ã©
deliberadamente excluÃ­do do registro de falha â€” nÃ£o Ã© uma falha do
leitor, e contÃ¡-lo junto inflaria artificialmente a taxa de erro.

Testado em `workbook-reader.test.ts` (bytes de origem/expandidos,
inclusive o caso CSV sem compressÃ£o) e `import-metrics.test.ts`
(construÃ§Ã£o de entrada de sucesso/falha, truncamento de mensagem,
acumulaÃ§Ã£o e limite de 200 entradas, comportamento em modo privado via
o mesmo padrÃ£o de `vi.stubGlobal` de `storage-privacy.test.ts`,
limpeza do histÃ³rico, e agregaÃ§Ã£o por leitor/fallback/shadow status).

Verificado com `npx vitest run` (455 passou, 11 pulados â€” 10 testes
novos, nenhum teste existente alterado alÃ©m dos dois `baseReport`
fixtures que ganharam `sourceBytes`/`expandedBytes`), `npx tsc --noEmit`
sem erros, `npm run build` aprovado e `npm run performance:check`
aprovado (402,2 KiB no maior chunk genÃ©rico, dentro do limite de
420 KiB â€” os dois campos novos e o mÃ³dulo de mÃ©tricas nÃ£o tÃªm peso
relevante no bundle).

## 38. Captura de erro do servidor por requisiÃ§Ã£o (era global e racy)

Corrige o item "MÃ©dia" da lista de melhorias trazida pelo usuÃ¡rio:
`error-capture.ts` (`src/lib/`) guardava o Ãºltimo erro capturado numa
Ãºnica variÃ¡vel de mÃ³dulo (`lastCapturedError`), compartilhada por
todas as invocaÃ§Ãµes concorrentes de `fetch` no mesmo isolado/worker do
servidor. `server.ts` usa isso para recuperar o erro real quando h3
"engole" um throw interno e devolve um 500 genÃ©rico
(`{"unhandled":true,"message":"HTTPError"}`, sem stack nem causa) â€”
ver `normalizeCatastrophicSsrResponse`.

**Bug real de concorrÃªncia, nÃ£o sÃ³ um cheiro de cÃ³digo**: sob duas
requisiÃ§Ãµes que falham ao mesmo tempo no mesmo processo, a segunda
chamada a `record()` (disparada pelo prÃ³prio `console.error` interno
do h3) sobrescrevia o erro da primeira antes dela conseguir
`consumeLastCapturedError()`. Resultado possÃ­vel: a requisiÃ§Ã£o A loga
o stack trace da requisiÃ§Ã£o B (atribuiÃ§Ã£o cruzada, confunde
investigaÃ§Ã£o de incidente), ou nenhuma das duas encontra seu prÃ³prio
erro (cai no fallback genÃ©rico `new Error("h3 swallowed SSR error: ...")`,
perdendo o stack de verdade). Como o erro jÃ¡ tinha sido *consumido*
por quem chegou primeiro, nÃ£o Ã© sÃ³ "podia ficar melhor" â€” Ã© perda de
informaÃ§Ã£o de diagnÃ³stico sob carga concorrente real, exatamente o
cenÃ¡rio em que mais se precisa do log correto.

**CorreÃ§Ã£o**: substituÃ­da a variÃ¡vel global por
`AsyncLocalStorage<RequestErrorContext>` (`node:async_hooks`, nativo
do runtime Node do Vercel confirmado em
`.vercel/output/functions/__server.func/.vc-config.json` â†’
`"runtime": "nodejs24.x"`). `runWithErrorCapture(secrets, fn)` cria um
contexto isolado por chamada; `server.ts` envolve o corpo inteiro de
`fetch` nele. `AsyncLocalStorage` propaga automaticamente por toda a
cadeia de `await` dentro de `fn`, entÃ£o `record()`/`consumeLastCapturedError()`
chamados em qualquer profundidade da mesma requisiÃ§Ã£o enxergam o
mesmo slot, isolado de outras requisiÃ§Ãµes paralelas no mesmo processo.
LimitaÃ§Ã£o aceita: os listeners globais de `error`/`unhandledrejection`
(erros verdadeiramente nÃ£o tratados, por definiÃ§Ã£o nÃ£o amarrados a
uma cadeia de `await` especÃ­fica) agora sÃ³ gravam quando disparam
dentro de algum `runWithErrorCapture` ativo â€” antes gravavam sempre,
mas podiam contaminar a requisiÃ§Ã£o errada; o novo comportamento troca
"sempre grava, Ã s vezes errado" por "sÃ³ grava quando pode ser
atribuÃ­do corretamente", mesmo trade-off que motivou o resto da
mudanÃ§a.

**Logs estruturados com redaÃ§Ã£o de segredos** (segunda parte pedida
pelo usuÃ¡rio): `runWithErrorCapture` recebe tambÃ©m a lista de segredos
conhecidos da requisiÃ§Ã£o (`OLI_SESSION_SECRET`, `OLI_CHAT_AUTH_TOKEN`,
`GEMINI_API_KEY` â€” os trÃªs valores sensÃ­veis que passam pelo `fetch`
do servidor, lidos de `env`/`process.env` do jeito que
`handleGeminiChat` jÃ¡ lia). `describeError` compara o texto do log por
igualdade exata contra cada segredo (nÃ£o regex de "parece um token" â€”
mais confiÃ¡vel, jÃ¡ que o valor exato Ã© conhecido) e substitui por
`[REDACTED]`; strings com menos de 6 caracteres sÃ£o ignoradas para nÃ£o
redigir texto comum por engano. `console.error` continua sendo o Ãºnico
canal de log (nÃ£o foi trocado por uma lib de logging estruturado, fora
de escopo desta correÃ§Ã£o) â€” "estruturado" aqui significa que o mesmo
formato de saÃ­da (mensagem + stack + cadeia de causas) agora nunca
carrega segredo em claro, nÃ£o que o formato de linha mudou.

Testado em `error-capture.test.ts`: duas "requisiÃ§Ãµes" concorrentes
(uma com atraso artificial via `setTimeout`, outra sÃ­ncrona) confirmam
que cada uma sÃ³ vÃª seu prÃ³prio erro mesmo executando em paralelo â€”
esse Ã© o teste de regressÃ£o do bug de concorrÃªncia descrito acima;
consumo Ãºnico (segunda chamada retorna `undefined`); expiraÃ§Ã£o por TTL
com `vi.useFakeTimers()`; redaÃ§Ã£o de segredo conhecido; segredos
vazios/indefinidos e strings curtas nÃ£o quebram nem redigem Ã  toa;
cadeia de causas e status preservados no texto do erro.

Verificado com `npx vitest run` (465 passou, 11 pulados â€” 10 testes
novos), `npx tsc --noEmit` sem erros, `npm run build` aprovado
(confirma que `node:async_hooks` empacota corretamente para o preset
Vercel configurado) e `npm run performance:check` aprovado (mesmos
402,2 KiB no maior chunk genÃ©rico â€” mudanÃ§a Ã© sÃ³ no bundle de
servidor, que este orÃ§amento nÃ£o mede).

## 39. `test:security-smoke` passa a rodar na CI

`scripts/security-smoke.mjs` jÃ¡ existia (confere cabeÃ§alhos de
seguranÃ§a CSP/`x-content-type-options`/`x-frame-options`/`referrer-policy`
contra um servidor rodando, o cookie de sessÃ£o de chat quando
`OLI_EXPECT_CHAT_SESSION=1`, e que uma origem cross-site recebe 403 em
`/api/gemini/chat`), mas nunca era executado automaticamente â€”
`.github/workflows/application.yml` sÃ³ rodava `npm run lint` e
`npm run verify` (testes + build + orÃ§amento de desempenho), nenhum
dos dois sobe um servidor de verdade para testar cabeÃ§alhos HTTP reais.

Novo job `security-smoke` (paralelo ao job `quality` existente,
mesmo runner/Node): sobe `npm run dev` em segundo plano com
`OLI_SESSION_SECRET` de CI (valor fixo sÃ³ para essa execuÃ§Ã£o efÃªmera,
nunca um segredo real, existe sÃ³ para exercitar o ramo de cÃ³digo que
assina o cookie de sessÃ£o), espera o servidor responder em
`http://127.0.0.1:3000/` com um laÃ§o de repetiÃ§Ã£o de atÃ© 30 segundos,
roda `npm run test:security-smoke` com `OLI_EXPECT_CHAT_SESSION=1`
(cobrindo tambÃ©m a asserÃ§Ã£o do cookie, nÃ£o sÃ³ os cabeÃ§alhos), e
encerra o servidor no fim (`if: always()`, mesmo se o smoke test
falhar).

**Por que `npm run dev`, nÃ£o o build de produÃ§Ã£o do preset Vercel**:
o `server.ts` exporta um handler `fetch` padrÃ£o Web, mas o build
gerado por `nitro({ preset: "vercel" })` (`.vercel/output/functions/__server.func/`)
estÃ¡ no formato especÃ­fico de runtime Node da Vercel (`NodeResponse`
do h3, `.vc-config.json` com `"launcherType": "Nodejs"`) â€” rodar isso
fora da prÃ³pria plataforma Vercel exigiria replicar o contrato de
invocaÃ§Ã£o deles, fora de escopo aqui. `vite dev` executa o mesmo
`server.ts` atravÃ©s do pipeline de SSR de desenvolvimento do TanStack
Start, no mesmo processo â€” os cabeÃ§alhos de seguranÃ§a nÃ£o tÃªm nenhum
branch condicional a build/dev (`http-security.ts`/`chat-session.ts`
auditados, sem `NODE_ENV`/`import.meta.env`), entÃ£o o smoke test
exercita o mesmo cÃ³digo de produÃ§Ã£o mesmo nÃ£o sendo o artefato exato
implantado.

**Validado sem rodar de fato pela CI** (o ambiente local nÃ£o linka
com o servidor de dev de forma alcanÃ§Ã¡vel por `curl` do lado do Bash
neste sandbox â€” limitaÃ§Ã£o jÃ¡ conhecida de rede isolada entre
ferramentas): os cabeÃ§alhos e o status da requisiÃ§Ã£o cross-origin
foram conferidos manualmente contra `npm run dev` atravÃ©s do
`fetch()` da prÃ³pria pÃ¡gina no navegador do preview deste ambiente
(via `javascript_tool`), confirmando CSP com `frame-ancestors 'none'`,
`x-content-type-options: nosniff`, `x-frame-options: DENY` e
`referrer-policy: strict-origin-when-cross-origin` presentes. A
asserÃ§Ã£o de 403 cross-origin nÃ£o pÃ´de ser confirmada dessa forma â€”
`fetch()` de dentro de uma pÃ¡gina nÃ£o pode sobrescrever o cabeÃ§alho
`Origin` (Ã© um cabeÃ§alho proibido pela spec Fetch para requisiÃ§Ãµes de
pÃ¡gina), entÃ£o o navegador sempre envia a origem real; o script Node
nÃ£o tem essa restriÃ§Ã£o (sÃ³ o `fetch` de navegador a impÃµe), entÃ£o essa
parte sÃ³ Ã© validÃ¡vel de fato rodando o script pela CI real â€” o YAML do
workflow foi validado sintaticamente (`npx js-yaml`), mas o
comportamento fim a fim da nova etapa `security-smoke` deve ser
conferido no primeiro run real da CI depois deste PR.

**Duas falhas reais sÃ³ visÃ­veis rodando a CI de verdade** (nÃ£o
reproduzÃ­veis neste sandbox, que nÃ£o alcanÃ§a o servidor de dev via
Bash â€” ver limitaÃ§Ã£o de rede isolada jÃ¡ registrada): a primeira
tentativa de wiring falhou porque `curl -sf --max-time 3` cortava
antes do primeiro prÃ©-empacotamento frio de dependÃªncias (recharts/
xlsx/leaflet/radix-ui, sem cache de `.vite` numa checkout nova)
terminar â€” corrigido subindo para `--max-time 60`. A segunda tentativa
ainda falhou, agora com toda chamada de `curl` recusada mesmo depois
do Vite jÃ¡ ter impresso "ready" â€” o prÃ³prio banner do Vite avisa
"Network: use --host to expose"; sem esse flag, a porta nÃ£o fica
alcanÃ§Ã¡vel em todas as interfaces locais do runner da GitHub Actions.
Corrigido com `npm run dev -- --host`. Terceira execuÃ§Ã£o: os dois jobs
passam (`security-smoke` em 31s), incluindo a asserÃ§Ã£o de 403
cross-origin que sÃ³ era validÃ¡vel rodando de verdade.

## 40. Painel de diagnÃ³stico de importaÃ§Ã£o (consumidor de `import-metrics.ts`)

A coleta de mÃ©tricas (seÃ§Ã£o 37) nÃ£o tinha nenhum consumidor de UI â€”
era coleta silenciosa em segundo plano. Novo componente
`src/components/oliam/import-diagnostics-dialog.tsx`
(`ImportDiagnosticsDialog`) fecha essa lacuna: carrega
`loadImportMetrics()` sob demanda (sÃ³ quando o diÃ¡logo abre, sem
manter nada em cache entre aberturas) e exibe, via
`summarizeImportMetrics()`, quatro cartÃµes de KPI (importaÃ§Ãµes
registradas, falhas, quantas usaram fallback para o leitor padrÃ£o,
paridade do shadow mode Rust/WASM: correspondeu/divergiu/falhou) mais
uma tabela pequena de contagem e tempo mÃ©dio por leitor. Segue o
padrÃ£o visual jÃ¡ usado em `import-workbench.tsx` ("BalanÃ§o verificÃ¡vel
da importaÃ§Ã£o") para os cartÃµes, nÃ£o introduz um padrÃ£o novo. Um botÃ£o
"Limpar histÃ³rico" abre um `AlertDialog` de confirmaÃ§Ã£o idÃªntico ao
jÃ¡ usado em `home.tsx` para excluir painel, chamando
`clearImportMetrics()`.

AcessÃ­vel pela paleta de comandos (`âŒ˜K`), novo item "DiagnÃ³stico de
importaÃ§Ã£o" logo depois de "Atalhos de teclado" â€” mesmo padrÃ£o de
entrada que os outros diÃ¡logos utilitÃ¡rios do painel (`CommandItem` +
`Dialog` controlado por um `useState` booleano em `Dashboard`).

**VerificaÃ§Ã£o neste ambiente foi parcial e inconclusiva por
instabilidade do prÃ³prio servidor de desenvolvimento**, nÃ£o por
suspeita de bug no cÃ³digo: a sessÃ£o de teste sofreu repetidos erros
`NitroViteError: Vite environment "nitro" is unavailable` (503) e
`[vite] server connection lost. Polling for restart...`, quebrando a
navegaÃ§Ã£o SSR de forma intermitente mesmo depois de reiniciar o
servidor de preview vÃ¡rias vezes â€” sintoma novo, nÃ£o documentado nas
sessÃµes anteriores. Apesar disso, duas confirmaÃ§Ãµes diretas foram
obtidas: (1) o item "DiagnÃ³stico de importaÃ§Ã£o" apareceu corretamente
e foi selecionÃ¡vel na paleta de comandos na primeira tentativa bem-
sucedida desta sessÃ£o, antes da instabilidade se instalar; (2) com a
navegaÃ§Ã£o quebrada, `fetch()` direto contra `/src/routes/index.tsx` e
`/src/components/oliam/import-diagnostics-dialog.tsx` (via
`javascript_tool`, contornando o router) confirmou os dois mÃ³dulos
sendo transformados e servidos pelo Vite sem erro (200, conteÃºdo
esperado presente), o que descarta erro de sintaxe/transformaÃ§Ã£o como
causa da instabilidade observada. `npx tsc --noEmit` e `npx eslint`
tambÃ©m sem erros. Fica registrado como verificaÃ§Ã£o visual pendente
para quando o ambiente estiver estÃ¡vel (preview da Vercel ou nova
sessÃ£o deste sandbox).

Verificado com `npx vitest run` (465 passou, 11 pulados, mesma
contagem â€” nenhum teste novo; o projeto nÃ£o usa
`@testing-library/react`, entÃ£o mudanÃ§as de UI aqui seguem o mesmo
padrÃ£o de risco das seÃ§Ãµes 26/28/29, verificaÃ§Ã£o manual em vez de
teste automatizado), `npx tsc --noEmit` sem erros, `npm run build`
aprovado e `npm run performance:check` aprovado â€” mas com margem menor
que antes: o chunk que virou "fachada" do grafo compartilhado (mesma
caracterÃ­stica de nomeaÃ§Ã£o de chunk documentada na seÃ§Ã£o 36, agora
recaindo sobre `import-diagnostics-dialog-*.js`) subiu para 406,8 KiB,
contra 402,2 KiB antes desta mudanÃ§a, ficando a sÃ³ 13,2 KiB do limite
de 420 KiB. NÃ£o Ã© um bug novo â€” Ã© a mesma consolidaÃ§Ã£o de cÃ³digo
compartilhado entre `/` e `/painel/$id` de sempre, sÃ³ que agora com
menos margem. Se a prÃ³xima mudanÃ§a em `Dashboard`/`WidgetCard`
adicionar bytes relevantes, o orÃ§amento pode estourar de novo e exigir
mais uma categoria de `manualChunks` em `vite.config.ts`.

## 41. Duas falhas reais na exportaÃ§Ã£o PDF/PNG, encontradas por screenshots reais do usuÃ¡rio

A auditoria visual completa de exportaÃ§Ã£o (seÃ§Ã£o "Estado conhecido",
`SECOND_BRAIN.md`) continuava bloqueada neste sandbox por falta de
RAF/screenshot funcional. O usuÃ¡rio trouxe screenshots reais de um PDF
exportado (fixture FRS-QA-BR-405) que expuseram dois bugs genuÃ­nos,
nenhum deles hipotÃ©tico.

**1. Colapso vertical letra-por-letra na linha de comparaÃ§Ã£o da fatia
selecionada do grÃ¡fico de pizza.** A palavra "Ãgua PotÃ¡vel" (e outros
textos da linha: "Filtrar", os valores de KPI) apareciam quebrados em
uma letra por linha, empilhados verticalmente por toda a pÃ¡gina â€”
sintoma clÃ¡ssico de uma coluna de grid espremida a quase 0px de
largura combinada com quebra de palavra forÃ§ada. Causa raiz, em
`widget-card.tsx` (bloco `w.type === "pie"`, painel de comparaÃ§Ã£o
`selectedPieComparison`/`pieComparisonFor`, `data-pipeline.ts:522-553`):
a grade `sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(7rem,0.7fr))_auto]`
tem a primeira coluna (nome + "PosiÃ§Ã£o X de Y categorias") com mÃ­nimo
explÃ­cito `0`. Na tela normal isso Ã© inofensivo porque `.truncate`
(`white-space: nowrap` + reticÃªncias) simplesmente corta o texto sem
quebrar layout. Mas `.oliam-export-mode .truncate` (`styles.css:1356`)
desliga deliberadamente essa proteÃ§Ã£o â€” `white-space: normal` +
`overflow-wrap: anywhere !important` â€” para nunca perder texto num
PDF. Sem essa proteÃ§Ã£o, e com a grade de exportaÃ§Ã£o forÃ§ando 3 colunas
fixas a 1440px (`EXPORT_SURFACE_WIDTH`, `export-layout.ts`), um widget
"pie" de largura 1/3 (~450px) nÃ£o tem espaÃ§o para as 3 colunas de
valor (mÃ­nimo 7rem/112px cada) + botÃ£o, entÃ£o a coluna de nome com
mÃ­nimo 0 Ã© espremida atÃ© quase desaparecer, e o texto sem `nowrap`
nÃ£o tem alternativa a nÃ£o ser quebrar entre cada caractere.

Corrigido em duas partes: (a) `minmax(0,1.4fr)` â†’ `minmax(8rem,1.4fr)`
para a coluna nunca colapsar abaixo de uma largura legÃ­vel mesmo com
quebra de palavra forÃ§ada; (b) nova classe estÃ¡vel
`oliam-pie-comparison-row` na `div` da linha, com uma regra CSS
(`styles.css`, logo apÃ³s o bloco que desliga truncamento) que empilha
a grade em uma Ãºnica coluna sÃ³ em `.oliam-export-mode` â€” evita que a
soma dos mÃ­nimos das 3 colunas de valor + botÃ£o ainda exceda a largura
real de um widget de span 1 mesmo com a coluna de nome corrigida, sem
alterar em nada a grade responsiva normal da tela.

**2. `<details>` fechado ("ObservaÃ§Ãµes da planilha") capturado num
estado inconsistente pelo html2canvas**, com texto de notas
sobreposto/cortado atrÃ¡s do cabeÃ§alho recolhido em vez de
completamente escondido ou completamente visÃ­vel. Causa raiz:
`exportBreakpoints()` (`dashboard-export.ts:45-46`) jÃ¡ usa o seletor
`"details li"` para calcular pontos de quebra de pÃ¡gina â€” cÃ³digo que sÃ³
faz sentido presumindo que o `<details>` estÃ¡ aberto â€” mas nada no
fluxo de captura de fato abria o elemento antes de capturar. O
`sourceNotesPanel` (`routes/index.tsx:2063-2089`, o painel
"ObservaÃ§Ãµes da planilha") nasce fechado por padrÃ£o (sem atributo
`open`), entÃ£o na tela viva o navegador esconde nativamente o
conteÃºdo â€” mas o html2canvas, ao clonar/renderizar o documento para o
canvas, nÃ£o reproduz de forma confiÃ¡vel esse comportamento nativo do
`<details>` fechado, produzindo o estado sobreposto/quebrado
observado.

Corrigido em `captureDashboard()` (`dashboard-export.ts`): antes de
capturar, todo `<details>` dentro do elemento exportado Ã© aberto
(`.open = true`), com o estado original de cada um salvo e restaurado
no `finally` â€” mesmo padrÃ£o jÃ¡ usado ali para posiÃ§Ã£o de scroll,
sem efeito colateral na UI viva (sÃ³ afeta o clone/captura).

**VerificaÃ§Ã£o**: com o RAF ainda nÃ£o funcional neste sandbox, a
auditoria visual completa do PDF exportado continuou bloqueada aqui
(mesma limitaÃ§Ã£o da seÃ§Ã£o anterior sobre exportaÃ§Ã£o). Verificado o que
dava para verificar sem RAF: `npx tsc --noEmit` sem erros; a regra CSS
nova confirmada presente e sintaticamente correta no stylesheet
servido pelo Vite (`fetch` direto do arquivo, via `javascript_tool`);
os dois mÃ³dulos alterados (`widget-card.tsx`, `dashboard-export.ts`)
confirmados sendo transformados e servidos sem erro.

**ConfirmaÃ§Ã£o visual (2026-08-15)**: o usuÃ¡rio gerou um novo PDF em
produÃ§Ã£o (Vercel, RAF funcional) e comparou com os screenshots
originais que motivaram esta seÃ§Ã£o â€” os dois bugs (colapso de texto
letra-por-letra na comparaÃ§Ã£o de fatia do grÃ¡fico de pizza e o
`<details>` "ObservaÃ§Ãµes da planilha" capturado em estado
inconsistente) nÃ£o reapareceram. As duas correÃ§Ãµes desta seÃ§Ã£o estÃ£o
confirmadas como corretas, nÃ£o apenas plausÃ­veis por leitura de
cÃ³digo.

Verificado com `npx vitest run` (465 passou, 11 pulados, mesma
contagem â€” este cÃ³digo nÃ£o tem teste unitÃ¡rio hoje, mesma lacuna jÃ¡
registrada para `dashboard-export.ts`/`export-layout.ts` por depender
de DOM real e `html2canvas`; ambiente de teste Ã© `environment: "node"`,
sem jsdom, entÃ£o nenhum teste novo foi forÃ§ado), `npx tsc --noEmit`
sem erros, `npm run build` + `npm run performance:check` aprovados
(sem mudanÃ§a relevante de tamanho de bundle â€” Ã© CSS/JSX pequeno).

## 42. DescompactaÃ§Ã£o OOXML Ãºnica e compartilhada entre metadados e verificaÃ§Ã£o independente

Primeiro recorte da lacuna P0 registrada na seÃ§Ã£o 2 ("InspeÃ§Ã£o OOXML
usa `unzipSync` e regex sobre XML completo... memÃ³ria duplicada e
risco em arquivos grandes"). Escopo deliberadamente pequeno: eliminar
uma descompactaÃ§Ã£o ZIP inteiramente redundante, sem tocar em nenhuma
lÃ³gica de comparaÃ§Ã£o, fÃ³rmula, formato ou reconciliaÃ§Ã£o de fidelidade
â€” o caminho crÃ­tico Ã© sensÃ­vel demais para uma mudanÃ§a maior sem
corpus de regressÃ£o robusto (risco jÃ¡ registrado no plano da seÃ§Ã£o 7).

Achado: em todo import de XLSX/XLSM/XLTX/XLTM, `readWorkbookBytes` e
`readWorkbookBytesWithEngine` (`workbook-reader.ts`) sempre chamavam,
em sequÃªncia, `attachWorkbookFeatures(wb, bytes)`
(`workbook-metadata.ts`) e `inspectOoxml(bytes)` (`ooxml-reader.ts`)
sobre os mesmos bytes. Cada uma dessas funÃ§Ãµes fazia seu prÃ³prio
`unzipSync(bytes)` independente â€” ou seja, todo arquivo OOXML era
descompactado e todo o XML relevante (planilhas, shared strings,
estilos, relaÃ§Ãµes, comentÃ¡rios, tabelas) era lido do zip duas vezes
por importaÃ§Ã£o, mesmo no caminho comum sem erro nem fallback.

CorreÃ§Ã£o: novo mÃ³dulo `src/lib/ooxml-archive.ts` (`unzipOoxmlArchive`,
`isOoxmlArchive`, tipo `OoxmlArchive`) concentra a Ãºnica chamada a
`unzipSync` que antes existia duplicada em `ooxml-reader.ts` e
`workbook-metadata.ts`. `inspectOoxml` e `attachWorkbookFeatures`/
`inspectWorkbookFeatures` passam a aceitar tanto bytes brutos quanto
um archive jÃ¡ descompactado (`ArrayBuffer | Uint8Array | OoxmlArchive`),
mantendo compatibilidade total com todo chamador existente que ainda
passa bytes (testes e `fidelity-meter.ts` nÃ£o mudam). Em
`workbook-reader.ts`, os dois pontos de entrada descompactam uma Ãºnica
vez (`sharedOoxmlArchive`, com fallback silencioso para bytes brutos
se a descompactaÃ§Ã£o falhar â€” preservando o comportamento de erro
anterior, em que cada funÃ§Ã£o tentaria e trataria a falha por conta
prÃ³pria) e passam o mesmo archive para as duas funÃ§Ãµes.

Nenhuma lÃ³gica de leitura, comparaÃ§Ã£o ou reconciliaÃ§Ã£o mudou â€” os
mesmos textos XML sÃ£o extraÃ­dos das mesmas entradas do zip, na mesma
ordem; sÃ³ a descompactaÃ§Ã£o em si deixou de ser feita duas vezes.

Teste de regressÃ£o em `workbook-reader.test.ts` usa `vi.spyOn` sobre
`unzipOoxmlArchive` e confirma exatamente uma chamada por importaÃ§Ã£o,
tanto no caminho sÃ­ncrono (`readWorkbookBytes`) quanto no assÃ­ncrono
(`readWorkbookBytesWithEngine`) â€” antes da mudanÃ§a esse teste teria
contado duas chamadas.

Verificado com `npx vitest run` (466 passou, 11 pulados, era 465),
`npx tsc --noEmit` sem erros, `npm run build` e `npm run
performance:check` aprovados (maior chunk genÃ©rico ainda em ~407 KiB,
sem mudanÃ§a â€” esta correÃ§Ã£o nÃ£o toca em cÃ³digo de UI nem muda o grafo
de mÃ³dulos entre arquivos de rota).

Itens restantes da lacuna P0 depois desta etapa: o parsing SheetJS
interno continua sendo um pass adicional sobre o mesmo pacote (fora do
controle deste mÃ³dulo, Ã© uma biblioteca de terceiros); e o XML ainda Ã©
lido inteiro em memÃ³ria por entrada (sem streaming), que Ã© a parte
mais arriscada e ainda nÃ£o abordada â€” precisa do corpus de regressÃ£o
robusto mencionado na seÃ§Ã£o 7 antes de qualquer mudanÃ§a na forma como
o XML Ã© percorrido.

**Segundo recorte, mesma etapa â€” `sheetMeta` percorria a dimensÃ£o
declarada duas vezes.** `sheetMeta` (`import-intelligence.ts`), que
monta os diagnÃ³sticos de importaÃ§Ã£o por aba (fÃ³rmulas, exemplos,
representaÃ§Ãµes de cÃ©lula, notas, modelo temporal), tinha dois laÃ§os
duplos independentes sobre exatamente o mesmo intervalo (`ref.s.r` a
`ref.e.r`, `ref.s.c` a `ref.e.c`, incluindo cÃ©lulas vazias dentro da
dimensÃ£o declarada): um sÃ³ para contar `formulaCells`, buscando a
cÃ©lula em cada endereÃ§o via `worksheetCellAtAddress`, e um segundo,
logo em seguida, que busca a mesma cÃ©lula no mesmo endereÃ§o de novo
para tudo o resto (exemplos de fÃ³rmula, representaÃ§Ãµes de origem,
notas, cÃ©lulas temporais) â€” inclusive checando `cell?.f` de novo sÃ³
para os 10 primeiros exemplos. Isso dobra o custo de
`worksheetCellAtAddress` por cÃ©lula da dimensÃ£o declarada, exatamente
o gargalo descrito na seÃ§Ã£o 6 ("`sheetMeta` percorre toda a dimensÃ£o
declarada, inclusive cÃ©lulas vazias").

Corrigido fundindo a contagem de `formulaCells` dentro do segundo
laÃ§o, no ponto em que a cÃ©lula jÃ¡ Ã© buscada para os exemplos de
fÃ³rmula â€” `formulaCells++` roda sempre que `cell?.f` Ã© verdadeiro, e o
`push` em `formulaExamples` continua limitado aos 10 primeiros como
antes. O primeiro laÃ§o foi removido inteiramente. Resultado idÃªntico,
metade das buscas de cÃ©lula por importaÃ§Ã£o nesta funÃ§Ã£o.

Nenhum teste novo foi necessÃ¡rio: `problematic-import.test.ts` jÃ¡
verifica `formulaCells` contra uma fixture real
(`expect(first?.diagnostics?.formulaCells).toBe(2)`) e continuou
passando sem alteraÃ§Ã£o, provando que a fusÃ£o dos dois laÃ§os preserva o
resultado.

Verificado com `npx vitest run` (466 passou, 11 pulados, mesma
contagem â€” nenhum teste novo, cobertura jÃ¡ existente), `npx tsc
--noEmit` sem erros, `npm run build` e `npm run performance:check`
aprovados (sem mudanÃ§a de tamanho de bundle relevante).

**MediÃ§Ã£o contra o corpus real antes de decidir sobre XML streaming.**
Antes de investir na reescrita mais arriscada da lacuna P0 (leitura de
XML inteiro em memÃ³ria, sem streaming â€” item 3 da seÃ§Ã£o 2), o custo
real foi medido contra os 5 arquivos do corpus sanitizado local
(`test-fixtures/sanitized-real/`, presente nesta mÃ¡quina), decompondo
`readWorkbookBytesWithEngine` em descompactaÃ§Ã£o, `inspectOoxml`
(verificaÃ§Ã£o cÃ©lula a cÃ©lula) e `inspectWorkbookFeatures` (metadados
avanÃ§ados).

Resultado: a descompactaÃ§Ã£o nunca passou de 86ms, mesmo no arquivo de
~2MB/67 mil cÃ©lulas. O tempo real estÃ¡ concentrado em `inspectOoxml`
(85-90% do total em todos os arquivos, atÃ© 588ms no maior arquivo) â€”
nÃ£o Ã© custo de I/O/descompactaÃ§Ã£o, Ã© o parsing cÃ©lula a cÃ©lula via
regex. Trocar para um parser XML streaming reduziria principalmente o
**pico de memÃ³ria** (evitar manter a string XML inteira + todos os
matches de regex simultÃ¢neos), nÃ£o o tempo de CPU, que Ã© O(cÃ©lulas)
de qualquer forma. O crescimento de heap medido foi modesto (atÃ©
~18,5 MB no maior arquivo real). O cenÃ¡rio de risco genuÃ­no â€” arquivos
perto do limite declarado de 2 milhÃµes de cÃ©lulas â€” extrapolaria para
algo como ~17s/~540MB sÃ³ nesta funÃ§Ã£o, mas nenhum arquivo real
disponÃ­vel chega perto disso.

DecisÃ£o registrada: a reescrita para streaming nÃ£o foi feita.
Risco/esforÃ§o desproporcional ao ganho medido no corpus disponÃ­vel â€”
seria uma mudanÃ§a grande na lÃ³gica de fidelidade mais crÃ­tica do
projeto para resolver um cenÃ¡rio extremo sem evidÃªncia real de
ocorrÃªncia. Fica como pendÃªncia explÃ­cita, condicionada a evidÃªncia
futura de arquivos grandes o suficiente para o problema se manifestar.

**Segundo achado com o mesmo escopo baixo-risco: duas alocaÃ§Ãµes
desperdiÃ§adas por cÃ©lula em `readSheet`.** No laÃ§o de cÃ©lulas
(o hot path chamado uma vez por cÃ©lula em toda importaÃ§Ã£o OOXML), dois
desperdÃ­cios comprovados por leitura de cÃ³digo, sem depender de
mudanÃ§a de comportamento:

1. `attributes(\`<c ${match[1] ?? match[2] ?? ""}>\`)` envolvia os
   atributos crus da cÃ©lula numa string sintÃ©tica `<c ...>` sÃ³ para
   reaproveitar a funÃ§Ã£o `attributes()` â€” mas o regex interno dela
   (`/([\w:-]+)="([^"]*)"/g`) nÃ£o Ã¢ncora em `<c`, varre `chave="valor"`
   em qualquer string. O wrapping era uma alocaÃ§Ã£o de string por
   cÃ©lula sem nenhum efeito no resultado; removido.
2. `xmlText(formula)` era chamado **duas vezes** para toda cÃ©lula com
   fÃ³rmula â€” uma para `ReaderCell.formula`, outra para `cell.f` â€” e
   `xmlText` faz 7 `.replace()` sequenciais. Corrigido computando
   `decodedFormula` uma vez e reaproveitando nos dois lugares; a
   checagem de presenÃ§a continua sobre o `formula` bruto (nÃ£o sobre
   `decodedFormula`) para preservar exatamente o comportamento
   anterior no caso extremo em que a fÃ³rmula decodifica para string
   vazia (ex.: `<f><x/></f>`, onde `formula` cru Ã© truthy mas
   `xmlText(formula)` resulta em `""`).

MediÃ§Ã£o comparativa (mesma metodologia, warm, mÃ©dia de 5 execuÃ§Ãµes,
antes/depois via `git stash`) mostrou ganho modesto e dentro do ruÃ­do
de mediÃ§Ã£o em alguns arquivos (2% a 16% mais rÃ¡pido em 5 dos 6
arquivos, 1 arquivo levemente mais lento dentro da margem de ruÃ­do) â€”
esperado, jÃ¡ que a alocaÃ§Ã£o eliminada Ã© uma fraÃ§Ã£o pequena do custo
total por cÃ©lula, dominado por `XLSX.SSF.format`, mÃºltiplos `exec` de
regex e `decode_cell`. Nenhum teste novo foi necessÃ¡rio: a suÃ­te de
fidelidade existente (`workbook-fidelity.test.ts`,
`problematic-import.test.ts`, `workbook-reader.test.ts`) cobre
fÃ³rmulas e passou sem alteraÃ§Ã£o, confirmando resultado idÃªntico.

Verificado com `npx vitest run` (466 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, `npm run build` e `npm run
performance:check` aprovados.

## 43. InÃ­cio de uma iniciativa maior: leitura guiada em mais widgets (`SeriesComparisonPanel`)

Pedido do usuÃ¡rio: adicionar mais conteÃºdo explicativo a todos os
widgets, no mesmo espÃ­rito do que jÃ¡ existia no grÃ¡fico de pizza (ver
seÃ§Ã£o 41 e o painel de comparaÃ§Ã£o de fatia), com liberdade para propor
novos widgets. Escopo grande o suficiente para ser tratado como uma
iniciativa em vÃ¡rias etapas pequenas e verificÃ¡veis, seguindo a mesma
convenÃ§Ã£o jÃ¡ usada para a otimizaÃ§Ã£o de leitura OOXML (seÃ§Ãµes 42-43) â€”
esta seÃ§Ã£o documenta a primeira etapa; etapas seguintes (linha/Ã¡rea,
tabela, ranking, widgets novos) devem registrar suas prÃ³prias entradas
sequenciais aqui em vez de expandir esta.

**Achado ao investigar**: `pieComparisonFor` (`data-pipeline.ts:522`)
jÃ¡ era genÃ©rica â€” opera sobre `{name, total}[]`, sem nada especÃ­fico de
pizza (rank, participaÃ§Ã£o %, referÃªncia = maior outra categoria,
diferenÃ§a absoluta/relativa). SÃ³ o pizza a usava porque sÃ³ ele tinha o
painel de leitura construÃ­do em cima dela.

**Primeira etapa entregue**: o painel de comparaÃ§Ã£o da fatia
selecionada foi extraÃ­do do JSX inline do pizza (`widget-card.tsx`)
para um componente compartilhado, `SeriesComparisonPanel`
(`widget-support.tsx`), parametrizado por `selected`/`comparison`/
`kind`/`onFilter`/`filterLabel` em vez de nomes especÃ­ficos de pizza.
O grÃ¡fico de **barras** passou a usar o mesmo componente:

- Estado novo `activeBarIndex` (hover apenas â€” diferente do pizza, que
  tambÃ©m tem `selectedPieIndex` via clique). DecisÃ£o deliberada: no
  bar, o clique jÃ¡ filtra diretamente (`handleGroupClick`), um
  comportamento existente e documentado; reaproveitar clique tambÃ©m
  para "selecionar para comparaÃ§Ã£o" mudaria essa semÃ¢ntica. O painel
  de barra segue o hover e, com nada sob o mouse, mostra por padrÃ£o a
  maior categoria â€” mesma regra "sempre mostrar algo Ãºtil" jÃ¡ usada no
  pizza (`summaryPieIndex`).
- `<Bar>` ganhou `onMouseEnter`/`onMouseLeave` (o pizza jÃ¡ tinha o
  equivalente no `<Pie>`) e as `<Cell>` ganharam o mesmo escurecimento
  (`opacity: 0.45`) das categorias nÃ£o destacadas que o pizza jÃ¡ tinha.
- BotÃ£o "Filtrar por esta categoria" no painel chama a mesma
  `handleGroupClick` que o clique direto na barra jÃ¡ chamava â€” nÃ£o Ã©
  uma aÃ§Ã£o nova, sÃ³ uma segunda forma de acionar a mesma aÃ§Ã£o.

**Reuso de proteÃ§Ã£o de exportaÃ§Ã£o**: a classe CSS que resolve o bug de
colapso de texto letra-por-letra em modo de exportaÃ§Ã£o (seÃ§Ã£o 41,
`.oliam-export-mode .oliam-pie-comparison-row` â†’ renomeada para
`.oliam-export-mode .oliam-series-comparison-row`) passou a cobrir
automaticamente qualquer novo uso do componente compartilhado, sem
precisar repetir a regra CSS. Isso resolve preventivamente a advertÃªncia
jÃ¡ registrada em `docs/SECOND_BRAIN.md` ("toda coluna de grid que usa
`.truncate`/`.line-clamp` precisa de `minmax(<valor razoÃ¡vel>, ...)`,
nunca `minmax(0, ...)`") para os prÃ³ximos widgets que adotarem o mesmo
painel.

**VerificaÃ§Ã£o**: `npx vitest run` (466 passou, 11 pulados, mesma
contagem â€” como jÃ¡ registrado nas seÃ§Ãµes 26/28/41, componentes React
sob `routes/index.tsx`/`components/oliam/` nÃ£o tÃªm convenÃ§Ã£o de teste
automatizado no projeto, `@testing-library/react` nÃ£o Ã© usado, mudanÃ§a
de UI segue verificaÃ§Ã£o manual), `npx tsc --noEmit` sem erros, `npm run
build` e `npm run performance:check` aprovados. **NÃ£o foi possÃ­vel
verificar visualmente no navegador desta sessÃ£o**: alÃ©m da limitaÃ§Ã£o jÃ¡
conhecida de nÃ£o simular o diÃ¡logo de upload de arquivo, o dev server
apresentou a instabilidade intermitente jÃ¡ documentada
(`NitroViteError: Vite environment "nitro" is unavailable`) mesmo apÃ³s
reiniciar o preview duas vezes e confirmar que nÃ£o havia processo
`node.exe` Ã³rfÃ£o na porta 3000 â€” mesma falha registrada como conhecida,
sem causa identificada. Risco considerado baixo: a lÃ³gica nova
(`activeBarIndex`, cÃ¡lculo de `selectedBar`/`selectedBarComparison`)
espelha exatamente o padrÃ£o jÃ¡ usado e testado indiretamente pelo pizza
hÃ¡ vÃ¡rias sessÃµes, e o componente extraÃ­do Ã© uma reorganizaÃ§Ã£o de JSX
jÃ¡ existente sem mudanÃ§a de comportamento para o pizza. Fica registrado
como verificaÃ§Ã£o pendente â€” se o usuÃ¡rio testar e encontrar algo
errado, comece relendo esta seÃ§Ã£o antes de investigar do zero.

## 44. Segunda etapa da mesma iniciativa: resumo de tendÃªncia em linha/Ã¡rea

ContinuaÃ§Ã£o da seÃ§Ã£o 43. Linha e Ã¡rea sÃ£o sÃ©ries **temporais**, nÃ£o
comparaÃ§Ãµes de categorias â€” `pieComparisonFor`/`SeriesComparisonPanel`
nÃ£o fariam sentido aqui (nÃ£o existe "a maior outra categoria" numa
sequÃªncia de tempo, existe "de onde veio, para onde foi"). Nova funÃ§Ã£o
pura `trendSummaryFor` (`data-pipeline.ts`), testada em
`data-pipeline.test.ts` (sÃ©rie normal, base zero no primeiro ponto,
menos de dois pontos), resume: primeiro ponto, Ãºltimo ponto, variaÃ§Ã£o
absoluta/relativa entre eles, ponto de mÃ­nimo, ponto de mÃ¡ximo e mÃ©dia
do perÃ­odo. Novo componente `TrendSummaryPanel`
(`widget-support.tsx`), renderizado logo abaixo do grÃ¡fico em linha e
em Ã¡rea.

**Cuidado deliberado com correÃ§Ã£o, nÃ£o sÃ³ duplicaÃ§Ã£o de padrÃ£o**: Ã¡rea
pode ser agrupada por qualquer coluna categÃ³rica, nÃ£o sÃ³ por data
(`groupOptions` em `widget-card.tsx` sÃ³ restringe isso para `line`,
nÃ£o para `area`). "InÃ­cio â†’ Fim" sÃ³ tem sentido quando o eixo Ã©
cronolÃ³gico de verdade â€” do contrÃ¡rio seria fabricar uma narrativa
temporal sobre uma comparaÃ§Ã£o categÃ³rica sem ordem natural, o tipo de
erro que o projeto explicitamente nÃ£o permite (ver `docs/SECOND_BRAIN.md`,
regras de produto). Por isso o painel sÃ³ aparece quando
`w.type === "line"` (sempre cronolÃ³gico, `groupOptions` jÃ¡ restringe a
colunas de data) ou `w.type === "area" && groupCol?.kind === "date"` â€”
exatamente a mesma condiÃ§Ã£o jÃ¡ usada para decidir se a sÃ©rie passa por
`sortChronologically` antes de chegar ao grÃ¡fico.

Reaproveitada a mesma proteÃ§Ã£o de exportaÃ§Ã£o da seÃ§Ã£o 43: nova classe
`oliam-trend-summary-row` adicionada preventivamente Ã  mesma regra CSS
que empilha a grade em modo de exportaÃ§Ã£o, em vez de esperar um bug
real de colapso de texto para corrigir depois.

Verificado com `npx vitest run` (469 passou, 11 pulados, era 466 â€” 3
testes novos de `trendSummaryFor`), `npx tsc --noEmit` sem erros,
`npm run build` e `npm run performance:check` aprovados (maior chunk
genÃ©rico subiu de ~407,6 para ~409,7 KiB, ainda dentro do limite de
420 KiB, mas a margem segue apertada â€” prÃ³ximas etapas desta iniciativa
devem continuar monitorando isso a cada PR). Mesma limitaÃ§Ã£o de
verificaÃ§Ã£o visual da seÃ§Ã£o 43 (dev server instÃ¡vel nesta sessÃ£o) â€”
fica pendente confirmaÃ§Ã£o visual do usuÃ¡rio.

## 45. Terceira etapa: cobertura do Top N no ranking

ContinuaÃ§Ã£o das seÃ§Ãµes 43-44. Um "Top N" mostra as maiores categorias
mas nunca dizia se elas eram quase tudo ou uma fraÃ§Ã£o pequena das
dezenas que podem existir na base. Nova funÃ§Ã£o pura
`rankingCoverageFor` (`data-pipeline.ts`, testada) recebe os itens
mostrados e a lista completa e devolve participaÃ§Ã£o do Top N no total,
contagem de categorias e quantas ficaram fora do ranking.

Faixa de aviso no topo do widget (mesmo estilo jÃ¡ usado pela "PrÃ©via
otimizada" do grÃ¡fico de barras, `bg-secondary-accent/8`): "Top 5
concentra 68,4% do total Â· 12 categorias no total, 7 fora deste
ranking." SÃ³ aparece quando existem categorias fora do Top N mostrado
(`coverage.remainingCount > 0`) â€” se o Top N jÃ¡ cobre tudo, a faixa
seria ruÃ­do.

`topShare` fica `null` (em vez de um nÃºmero enganoso) quando o total
geral nÃ£o Ã© positivo â€” participaÃ§Ã£o percentual nÃ£o tem leitura
confiÃ¡vel com soma zero ou negativa (ex.: mÃ©trica com valores positivos
e negativos que se cancelam).

**Erro real pego sÃ³ pela CI, nÃ£o localmente**: dois erros reais de
Prettier (um `title` de JSX que devia quebrar em vÃ¡rias linhas na
`SeriesComparisonPanel` da etapa 43, um array de teste formatado errado
em `data-pipeline.test.ts` desta etapa) passaram batido por
`npx eslint <arquivo>` localmente â€” o volume de ruÃ­do CRLF prÃ©-existente
(milhares de ocorrÃªncias de `Delete \`â\`` neste checkout Windows) afoga
qualquer erro real de conteÃºdo no mesmo output, e sÃ³ apareceram quando a
CI do GitHub (Linux, sem CRLF) rodou de fato. Corrigido depois de
confirmar com uma verificaÃ§Ã£o que normaliza CRLFâ†’LF numa cÃ³pia
temporÃ¡ria antes de rodar `prettier --check` (registrado como memÃ³ria
de sessÃ£o para nÃ£o repetir o erro). Nenhuma lÃ³gica foi afetada â€” os
dois eram sÃ³ formataÃ§Ã£o.

Verificado com `npx vitest run` (471 passou, 11 pulados, era 469 â€” 2
testes novos de `rankingCoverageFor`), `npx tsc --noEmit` sem erros,
verificaÃ§Ã£o de Prettier com CRLF normalizado limpa em todos os arquivos
alterados da iniciativa (nÃ£o sÃ³ os desta etapa), `npm run build` e
`npm run performance:check` aprovados (maior chunk genÃ©rico em
~410,4 KiB). Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual pendente das etapas
anteriores.

## 46. Quarta etapa: quanto foi filtrado na tabela detalhada

ContinuaÃ§Ã£o das seÃ§Ãµes 43-45. A tabela detalhada (`w.type === "table"`,
fallback final de `WidgetCard`) sempre mostrou `data` (linhas jÃ¡
filtradas por busca/filtros de widget) sem dizer se isso era tudo que
existia na planilha ou uma fraÃ§Ã£o. Diferente das etapas anteriores,
esta exigiu um prop novo (`totalRows`) em vez de sÃ³ reorganizar dado
jÃ¡ calculado dentro do componente â€” `WidgetCard` sÃ³ recebia `data`
(pÃ³s-filtro), nunca o total anterior aos filtros.

`totalRows` Ã© passado do Ãºnico ponto de instanciaÃ§Ã£o de `WidgetCard`
(`routes/index.tsx`) como `rulesApplied.length` â€” as linhas depois de
regras de dado ausente (`applyMissingRules`, que pode ocultar linha
deliberadamente) mas antes de busca e filtros de widget. Essa Ã© a base
correta de comparaÃ§Ã£o: "quanto a busca/filtro escondeu", nÃ£o "quanto a
regra de dado ausente escondeu" (essa jÃ¡ Ã© uma decisÃ£o do usuÃ¡rio
sobre a coluna, nÃ£o um filtro temporÃ¡rio).

Faixa "Mostrando X de Y linhas Â· Z ocultas por busca ou filtros
ativos", mesmo estilo `bg-secondary-accent/8` das etapas anteriores, sÃ³
aparece quando `totalRows !== data.length` (senÃ£o seria ruÃ­do dizendo
o Ã³bvio).

**Erro real de Prettier pego antes do push desta vez** (nÃ£o na CI): o
texto do parÃ¡grafo quebrou numa linha diferente da esperada pelo
Prettier. Confirmado e corrigido com a mesma verificaÃ§Ã£o de CRLFâ†’LF
registrada na memÃ³ria de sessÃ£o da etapa 45, antes de commitar â€” dessa
vez sem precisar da CI para descobrir.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem â€” mudanÃ§a de prop/JSX, sem lÃ³gica nova testÃ¡vel isoladamente),
`npx tsc --noEmit` sem erros (confirma que o Ãºnico ponto de
instanciaÃ§Ã£o de `WidgetCard` foi atualizado corretamente), Prettier
limpo, `npm run build` e `npm run performance:check` aprovados (maior
chunk genÃ©rico em ~410,8 KiB). Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual
pendente.

## 47. Widget novo: Insights automÃ¡ticos (`insights`)

Fecha a iniciativa das seÃ§Ãµes 43-46 com um widget proposto pelo
usuÃ¡rio: em vez de melhorar um grÃ¡fico existente, narra em texto os
achados de uma mÃ©trica por categoria, sem nenhum desenho â€” a diferenÃ§a
proposital em relaÃ§Ã£o a todos os outros widgets de grÃ¡fico/tabela.
Escolhida entre duas opÃ§Ãµes apresentadas ao usuÃ¡rio (a alternativa era
um comparador de perÃ­odos, que exigiria modelo de dados novo; esta
reaproveita inteiramente funÃ§Ãµes jÃ¡ testadas).

**ComposiÃ§Ã£o, sem lÃ³gica nova a testar isoladamente** â€” os trÃªs
achados vÃªm de funÃ§Ãµes puras jÃ¡ existentes e cobertas por teste,
aplicadas sobre a mesma sÃ©rie (`chartSeries`) que bar/pizza/ranking jÃ¡
usam:

1. **Quem lidera**: `pieComparisonFor(sorted, 0)` sobre a sÃ©rie
   ordenada â€” reaproveita a mesma funÃ§Ã£o da seÃ§Ã£o 43, agora numa
   terceira posiÃ§Ã£o de uso. "X lidera com Y (Z% do total) â€” W% Ã 
   frente de [segunda colocada]."
2. **ConcentraÃ§Ã£o do topo**: `rankingCoverageFor(sorted.slice(0,3),
   sorted)` â€” reaproveita a funÃ§Ã£o da seÃ§Ã£o 45. "As 3 maiores
   categorias concentram N% do total; restam M categorias menores."
   Omitido quando nÃ£o hÃ¡ categorias fora do top 3 (mesmo critÃ©rio jÃ¡
   usado no ranking).
3. **Qualidade de dados**: `detectQualitySignals(data, [groupCol,
   valueCol])`, restrita Ã s duas colunas em uso pelo widget â€” a base
   inteira jÃ¡ tem seu prÃ³prio painel global (`routes/index.tsx`, banner
   dispensÃ¡vel jÃ¡ existente); repetir tudo aqui seria ruÃ­do, nÃ£o
   achado novo. SÃ³ o subconjunto relevante para o que este widget
   especificamente mostra.

**DecisÃ£o deliberada: nÃ£o entra na recomendaÃ§Ã£o automÃ¡tica.** Registro
extra da regra jÃ¡ documentada em `docs/SECOND_BRAIN.md` ("painel de
exceÃ§Ãµes e validaÃ§Ã£o sÃ£o widgets manuais; nÃ£o entram automaticamente
no painel"), agora explicitamente estendida a este widget. Mexer em
`auto-dashboard.ts` para recomendar automaticamente Ã© uma decisÃ£o de
produto com alcance amplo (afeta todo painel novo criado a partir de
agora) â€” fora do escopo combinado com o usuÃ¡rio para esta etapa.
`createWidget` (`widgets.ts`) ganhou suporte a criar o widget
manualmente pelo seletor "Adicionar widget" (mesmos padrÃµes de
`groupKey`/`valueKey`/`op` de bar/ranking/mapa), mas nada em
`auto-dashboard.ts` foi tocado.

**Checklist de registro de `WidgetType` novo, para a prÃ³xima vez**:
esta etapa expÃ´s todos os pontos que precisam mudar juntos ao
adicionar um tipo de widget â€” `types.ts` (uniÃ£o + label),
`widget-support.tsx` (`widgetTypeDescriptions` + `WidgetPickerIcon`),
`widgets.ts` (`defaultSpan` + branch de `createWidget`),
`widget-card.tsx` (bloco de renderizaÃ§Ã£o) e, o que nÃ£o Ã© Ã³bvio,
`routes/index.tsx` (`canAdd: Record<WidgetType, boolean>`, que decide
se o tipo aparece habilitado no seletor "Adicionar widget" dado o
formato da planilha atual) â€” `npx tsc --noEmit` pegou o esquecimento
deste Ãºltimo ponto automaticamente, por ser um `Record` exaustivo
sobre `WidgetType`.

**AtenÃ§Ã£o ao orÃ§amento de bundle**: depois desta etapa o maior chunk
genÃ©rico subiu para ~414,7 KiB, contra o limite de 420 KiB â€” a margem
que jÃ¡ vinha apertada desde a seÃ§Ã£o 42 ficou genuinamente crÃ­tica
(~5,3 KiB de folga). A prÃ³xima mudanÃ§a de peso relevante em
`import-diagnostics-dialog`/`widget-card.tsx` provavelmente vai exigir
isolar mais uma categoria de vendor em `manualChunks`
(`vite.config.ts`) antes de conseguir crescer mais, nÃ£o sÃ³ rodar
`npm run performance:check` reativamente.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem â€” composiÃ§Ã£o de funÃ§Ãµes jÃ¡ testadas, sem lÃ³gica pura nova),
`npx tsc --noEmit` sem erros, Prettier limpo (verificaÃ§Ã£o CRLFâ†’LF),
`npm run build` e `npm run performance:check` aprovados. Mesma
limitaÃ§Ã£o de verificaÃ§Ã£o visual pendente das etapas anteriores â€” a
faixa de "Adicionar widget" e o prÃ³prio conteÃºdo do widget nÃ£o foram
vistos renderizados de verdade nesta sessÃ£o.

## 48. Bug real reportado pelo usuÃ¡rio: eixo Y piscava ao passar o mouse na barra

A PR #99 (seÃ§Ã£o 43) introduziu `onMouseEnter`/`onMouseLeave` no `<Bar>`
para acionar `setActiveBarIndex` e mostrar o painel de comparaÃ§Ã£o por
hover. O usuÃ¡rio reportou que, depois disso, os nÃºmeros do eixo Y do
grÃ¡fico de barras somem e voltam ao passar o mouse sobre as barras.

**Causa raiz**: `setActiveBarIndex` re-renderiza `WidgetCard`, que
recalcula `barSeries` (via `chartSeries(...)`) do zero a cada
renderizaÃ§Ã£o â€” um array com identidade de referÃªncia nova mesmo quando
o conteÃºdo Ã© idÃªntico, jÃ¡ que nada nessa cadeia de cÃ¡lculo Ã©
memoizado. O Recharts recebe essa nova referÃªncia em `data={barSeries}`
e trata como "o dado do grÃ¡fico mudou": reinicia a animaÃ§Ã£o de entrada
da barra (`animationDuration={500}`, ativa por padrÃ£o) e recalcula o
layout, incluindo o eixo Y â€” visualmente, os ticks desaparecem e
reaparecem a cada passagem do mouse, porque antes o hover nÃ£o
disparava re-render nenhum no grÃ¡fico de barras (sÃ³ o pizza tinha esse
padrÃ£o, e `RPieChart` nÃ£o tem eixo para piscar).

**CorreÃ§Ã£o**: `isAnimationActive={false}` no `<Bar>`, removendo a
propriedade `animationDuration` (que perde efeito sem animaÃ§Ã£o ativa).
Mesmo ajuste jÃ¡ existente no cÃ³digo para o sparkline da mÃ©trica com
tendÃªncia (`widget-card.tsx`, ~linha 1388), aplicado ao mesmo tipo de
problema â€” nÃ£o foi inventado um padrÃ£o novo. A causa raiz mais
profunda (recalcular toda a cadeia de dados do widget a cada
re-render, sem memoizaÃ§Ã£o) Ã© maior que este bug especÃ­fico e nÃ£o foi
tocada; a correÃ§Ã£o resolve o sintoma visÃ­vel da forma mais estreita e
segura possÃ­vel, sem mudar a lÃ³gica de recÃ¡lculo de nenhum outro
widget.

**VerificaÃ§Ã£o**: mesma limitaÃ§Ã£o de sandbox das etapas anteriores â€” o
dev server continuou instÃ¡vel (`NitroViteError`) e nÃ£o foi possÃ­vel
confirmar visualmente que o flicker desapareceu. A causa raiz foi
identificada por leitura de cÃ³digo e Ã© uma explicaÃ§Ã£o mecÃ¢nica
completa e consistente com o sintoma relatado (Recharts reinicia
animaÃ§Ã£o/recalcula eixo quando a referÃªncia de `data` muda), nÃ£o uma
hipÃ³tese nÃ£o verificada. Pede confirmaÃ§Ã£o do usuÃ¡rio depois do deploy.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo, `npm run
build` e `npm run performance:check` aprovados (~414,7 KiB, sem
mudanÃ§a de tamanho â€” Ã© uma linha de JSX a menos, uma prop a mais).

## 49. Sexta e sÃ©tima etapas: avaliaÃ§Ã£o (distribuiÃ§Ã£o) e mapa (local lÃ­der)

Fecha os dois widgets que ficavam "parciais" na tabela da seÃ§Ã£o 43 do
levantamento original.

**AvaliaÃ§Ã£o (`rating`)**: a mÃ©dia sozinha esconde o quÃ£o espalhadas as
notas estÃ£o â€” 3,0 pode ser tudo em torno de 3, ou metade em 1 e metade
em 5. Nova linha de contexto, sÃ³ com aritmÃ©tica local (sem funÃ§Ã£o de
pipeline nova): `MÃ­nimo`/`MÃ¡ximo` das notas e `% abaixo da mÃ©dia`.

**Mapa (`map`)**: painel estÃ¡tico (nÃ£o depende de hover nos
marcadores) mostrando o local lÃ­der, reaproveitando
`pieComparisonFor`/`SeriesComparisonPanel` â€” mesma composiÃ§Ã£o jÃ¡ usada
por barra e insights. **DecisÃ£o deliberada de nÃ£o estender hover para
o mapa**: `MapWidgetBody` roda o Leaflet dentro de `useEffect`
imperativo (criaÃ§Ã£o de mapa, camadas, marcadores); cruzar isso com
estado de hover declarativo exigiria plumbing adicional atravÃ©s da
fronteira imperativa/declarativa, exatamente a categoria de mudanÃ§a
que gerou o bug real da seÃ§Ã£o 48 (re-render disparado por hover
recalculando estruturas com identidade nova). Um painel estÃ¡tico que
sempre mostra o lÃ­der dÃ¡ a mesma leitura guiada sem esse risco.

**AtenÃ§Ã£o â€” orÃ§amento de bundle ficou mais apertado**: maior chunk
genÃ©rico em ~415,3 KiB contra o limite de 420 KiB, ~4,7 KiB de folga.
Tentativa de isolar `widget-card.tsx`/`widget-support.tsx` num chunk
prÃ³prio jÃ¡ foi tentada e revertida (seÃ§Ã£o anterior, registrada tambÃ©m
em `docs/SECOND_BRAIN.md`) por piorar em vez de ajudar. Sem uma anÃ¡lise
real do grafo de dependÃªncias (ex. `rollup-plugin-visualizer`), a
prÃ³xima adiÃ§Ã£o de peso relevante a `widget-card.tsx` corre risco real
de estourar o limite â€” vale essa anÃ¡lise antes de continuar
adicionando conteÃºdo a este arquivo especificamente.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo, `npm run
build` e `npm run performance:check` aprovados (~415,3 KiB). Mesma
limitaÃ§Ã£o de verificaÃ§Ã£o visual pendente.

## 50. Reauditoria de fidelidade: as 8 lacunas da seÃ§Ã£o 3, verificadas por cÃ³digo

Pedido do usuÃ¡rio: revisitar as lacunas documentadas na seÃ§Ã£o 3
("Parcial ou nÃ£o suportado de forma completa") para saber se ainda sÃ£o
reais ou se evoluÃ­ram nas sessÃµes desde que foram escritas. Escopo
deliberadamente sÃ³ investigativo/documental nesta etapa â€” nenhum
cÃ³digo foi alterado.

Resultado: 7 das 8 lacunas continuam exatamente como descritas
originalmente, sem nenhuma evoluÃ§Ã£o. Uma evoluiu parcialmente.

1. **Fills/fontes/bordas/cores**: sem mudanÃ§a. `ReaderCell`
   (`ooxml-reader.ts:7-13`) sÃ³ tem `address`, `rawValue`,
   `displayValue`, `numberFormat`, `formula` â€” nada de estilo visual.
2. **Imagens/desenhos/objetos/grÃ¡ficos nativos**: sem mudanÃ§a. Zero
   ocorrÃªncia de "drawing"/"image"/"chart"/"oleObject" nos trÃªs
   arquivos de leitura verificados.
3. **ValidaÃ§Ãµes de dados/outlines/slicers**: sem mudanÃ§a. Zero
   ocorrÃªncia de "dataValidation"/"outlineLevel"/"slicer".
   `OoxmlSheetStructure` (`ooxml-reader.ts:30-34`) sÃ³ tem
   `mergedRanges`/`hiddenRows`/`hiddenColumns`.
4. **Hyperlinks â€” parcialmente evoluÃ­do.** `parseHyperlinks`
   (`workbook-metadata.ts:117-143`) jÃ¡ extrai endereÃ§o, destino e
   tooltip, resolvendo relacionamentos externos e Ã¢ncoras internas â€”
   isso nÃ£o existia quando a lacuna foi escrita. Mas o Ãºnico
   consumidor (`attachWorkbookFeatures`, `workbook-metadata.ts:243-253`)
   sÃ³ usa isso para preencher `cell.l` do SheetJS cÃ©lula a cÃ©lula;
   depois disso `advanced.hyperlinks` nÃ£o Ã© lido em lugar nenhum â€”
   nem `import-intelligence.ts` (que usa `advanced.structuredTables`/
   `pivotTables` do mesmo objeto, mas nÃ£o `advanced.hyperlinks`), nem
   nenhuma UI. Existe extraÃ§Ã£o, nÃ£o existe inventÃ¡rio rastreÃ¡vel e
   consultÃ¡vel, que era o objetivo original da lacuna.
5. **Nomes definidos**: sem mudanÃ§a. Zero ocorrÃªncia de "definedName"
   em todo `src/`.
6. **Links externos**: sem mudanÃ§a. Zero ocorrÃªncia de
   "externalReference"/"externalLink" em todo `src/`.
7. **Macros VBA**: sem mudanÃ§a. As Ãºnicas ocorrÃªncias de
   "macro"/"vba" em `src/` sÃ£o rÃ³tulos de UI para extensÃ£o de arquivo
   (`folder-monitor-widget.tsx`) e a entrada estÃ¡tica na lista de nÃ£o
   suportados â€” nenhum parsing de `vbaProject.bin`.
8. **RecÃ¡lculo integral de fÃ³rmulas**: continua sendo, por desenho,
   um "avaliador propositalmente limitado" (comentÃ¡rio de cabeÃ§alho,
   `formula.ts:1-31`) â€” sÃ³ recupera valor de fÃ³rmula sem cache
   gravado no arquivo, nunca recalcula a planilha inteira. Escopo
   cresceu marginalmente desde a Ãºltima verificaÃ§Ã£o: `SUMIF`/`COUNTIF`
   se juntaram a `IF`/`AND`/`OR`/`IFERROR`/`ROUND`/`ABS`/`SUM`/
   `AVERAGE`/`COUNT`/`MIN`/`MAX` (`formula.ts:271`). Continua sem
   referÃªncia entre abas, sem `VLOOKUP`/`XLOOKUP`/`INDEX`/`MATCH`, sem
   texto/data â€” qualquer funÃ§Ã£o fora da lista lanÃ§a erro em runtime
   (`formula.ts:165`).
9. **XLS/Numbers/ODS corrompidos**: sem mudanÃ§a. A Ãºnica checagem de
   "corromp" em `src/` (`workbook-reader.ts:75`) lanÃ§a erro e aborta
   ao detectar EOCD de ZIP incompleto â€” nÃ£o Ã© um leitor alternativo
   nem um modo degradado, Ã© uma rejeiÃ§Ã£o.
10. **Auditoria de abas vazias/ocultas**: sem mudanÃ§a, apesar de a
    seÃ§Ã£o 28 (matriz de confianÃ§a por aba) parecer relacionada Ã 
    primeira vista. `buildSheetConfidenceMatrix`
    (`import-intelligence.ts:140-164`) sÃ³ reclassifica diagnÃ³sticos jÃ¡
    calculados sobre o array `sheets` que jÃ¡ recebe como argumento â€”
    e esse array vem de `sheetsWithData` (`import.ts:2364-2370`), que
    por definiÃ§Ã£o jÃ¡ excluiu abas sem dado antes de chegar na matriz.
    TambÃ©m nÃ£o existe leitura de visibilidade de aba
    (`Hidden`/`SheetVisibility` do `workbook.xml`) em lugar nenhum â€”
    sÃ³ de linhas ocultas dentro de uma aba, um conceito diferente.

A seÃ§Ã£o 3 (lista curta) foi atualizada acima para refletir este
levantamento. Nenhum cÃ³digo foi alterado nesta etapa â€” Ã©
deliberadamente sÃ³ o mapeamento pedido pelo usuÃ¡rio antes de decidir o
que, se algo, vale a pena implementar. Dos itens acima, os mais
plausÃ­veis para uma prÃ³xima etapa de implementaÃ§Ã£o, por ordem de
esforÃ§o/risco crescente, seriam: (a) expor o inventÃ¡rio de hyperlinks
jÃ¡ extraÃ­do em algum lugar consultÃ¡vel (menor esforÃ§o, dado jÃ¡ existe
e sÃ³ precisa de um consumidor novo); (b) inventariar nomes
definidos/links externos (esforÃ§o mÃ©dio, parsing novo mas seguindo o
mesmo padrÃ£o jÃ¡ usado para hyperlinks); (c) qualquer coisa envolvendo
imagens/desenhos, validaÃ§Ãµes ou macros (esforÃ§o maior, formato XML
mais complexo e sem precedente de parsing no cÃ³digo atual).

## 51. Primeira etapa da extraÃ§Ã£o do Dashboard: diÃ¡logo de "combinar planilha"

Primeiro corte do plano de extraÃ§Ã£o apresentado ao usuÃ¡rio (registro
do plano completo abaixo). Escolhido por ser o bloco mais autocontido
dos ~32 `useState` de `Dashboard`: 9 estados sÃ³ usados entre si
(`joinOpen`...`joinSheetPickerIndex`), lÃ³gica isolada (`applyJoinSheet`,
`parseJoinFile`, `confirmJoinSheetPicker`, `resetJoin`, `combineJoin`)
e ~115 linhas de JSX que nÃ£o referenciam nada especÃ­fico do resto de
`Dashboard` alÃ©m de `sheet.columns`/`sheet.rows` e `updateSheet`.

ExtraÃ­do para `src/components/oliam/join-sheet-dialog.tsx`, mesmo
padrÃ£o jÃ¡ usado para `SheetPickerDialog` (que o novo hook tambÃ©m
reaproveita internamente, sem duplicar a lÃ³gica de escolha de aba).
`useJoinSheetDialog(columns, rows, onCombine)` retorna `{ openJoin,
dialog }` â€” o chamador nÃ£o precisa saber que existem 9 estados internos,
sÃ³ chama `openJoin()` nos dois gatilhos (botÃ£o da barra de ferramentas
e item da paleta de comandos) e renderiza `{dialog}` uma vez. MudanÃ§a
puramente estrutural: nenhuma lÃ³gica de junÃ§Ã£o (`leftJoin`) foi tocada.

**Plano completo de extraÃ§Ã£o do `Dashboard`** (`routes/index.tsx`,
1164 atÃ© o fim do arquivo, ~2.575 linhas), por ordem de risco
crescente â€” cada etapa deve ser seu prÃ³prio PR pequeno e verificÃ¡vel:

1. ~~DiÃ¡logo de junÃ§Ã£o~~ â€” feito nesta etapa.
2. Modo apresentaÃ§Ã£o (`presentation`, `autoPlay`, `presentIndex`,
   `intervalSeconds`, 4 estados).
3. Editor de fÃ³rmula (`addingFormula`, `formulaLabel`, `formulaText`,
   `formulaError`, 4 estados).
4. Painel de bookmark (`bookmarkPanel`, `bookmarkName`, 2 estados).
5. Reavaliar o que sobra: busca/filtro, exportaÃ§Ã£o, revisÃ£o de fundo,
   cÃ©lulas focadas, sinais de qualidade â€” provavelmente continuam em
   `Dashboard`, entrelaÃ§ados com a cadeia de `useMemo` do pipeline de
   dados. **NÃ£o recomendado um reducer Ãºnico** para os itens 2-4: os
   estados nÃ£o formam uma mÃ¡quina de estados coesa, sÃ£o recursos
   independentes; um reducer grande sÃ³ trocaria um objeto-deus por
   outro.

**Achado crÃ­tico sobre o orÃ§amento de bundle**: esta extraÃ§Ã£o Ã©
puramente estrutural (move cÃ³digo, nÃ£o adiciona lÃ³gica nova), mas o
maior chunk genÃ©rico ainda assim subiu de ~415,3 para ~418,6 KiB â€”
**margem de sÃ³ 1,4 KiB** contra o limite de 420 KiB. Isso confirma, de
novo, a mesma fragilidade jÃ¡ registrada nas seÃ§Ãµes 42 e na tentativa
revertida de isolar `widget-card`/`widget-support`: mover cÃ³digo entre
arquivos de primeira-parte muda qual mÃ³dulo vira a "fachada" do chunk
compartilhado, mesmo sem nenhuma mudanÃ§a de comportamento. **As
prÃ³ximas etapas do plano acima (2-4) tÃªm risco real de estourar o
orÃ§amento mesmo sendo extraÃ§Ãµes igualmente pequenas e "seguras" em
termos de lÃ³gica** â€” a margem jÃ¡ nÃ£o suporta outra rodada de churn
estrutural sem uma decisÃ£o explÃ­cita: aumentar o limite do orÃ§amento
(`scripts/check-performance-budget.mjs`) para refletir o crescimento
real e legÃ­timo do produto, ou investir em anÃ¡lise real do grafo de
dependÃªncias (`rollup-plugin-visualizer`, nÃ£o instalado hoje) antes de
continuar. Registrado para o usuÃ¡rio decidir antes da prÃ³xima etapa.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem â€” hook novo Ã© reorganizaÃ§Ã£o de lÃ³gica jÃ¡ existente, sem teste
automatizado para componentes React sob `routes/index.tsx`/
`components/oliam/`, mesma lacuna jÃ¡ registrada), `npx tsc --noEmit`
sem erros, Prettier limpo, `npm run build` e `npm run
performance:check` aprovados, mas com a margem crÃ­tica descrita acima.
Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual pendente das etapas anteriores â€”
o fluxo de combinar planilha (upload, escolha de colunas, confirmaÃ§Ã£o)
nÃ£o foi exercitado de verdade nesta sessÃ£o.

**DecisÃ£o do usuÃ¡rio sobre o achado acima**: em vez de investir em
anÃ¡lise real do grafo de dependÃªncias agora ou pausar a extraÃ§Ã£o, o
usuÃ¡rio optou por subir o limite do orÃ§amento genÃ©rico de 420 para
450 KiB (`scripts/check-performance-budget.mjs`), reconhecendo que o
crescimento Ã© legÃ­timo (iniciativa de widgets explicativos + widget
novo + inÃ­cio da extraÃ§Ã£o do Dashboard), nÃ£o inchaÃ§o acidental. DÃ¡
margem (~31 KiB acima do estado atual de ~418,6 KiB) para terminar as
etapas 2-4 do plano de extraÃ§Ã£o sem reabrir essa decisÃ£o a cada PR
pequena. Se a margem voltar a ficar apertada depois dessas etapas, a
anÃ¡lise real com `rollup-plugin-visualizer` continua sendo o caminho
recomendado antes de subir o limite de novo â€” subir o nÃºmero
repetidamente sem entender a causa vira sÃ³ adiar o problema.

## 52. Etapas 2-4 da extraÃ§Ã£o do Dashboard: apresentaÃ§Ã£o, fÃ³rmula, bookmark

Fecha o plano de extraÃ§Ã£o registrado na seÃ§Ã£o 51, com a margem de
orÃ§amento jÃ¡ resolvida. `routes/index.tsx` caiu de 3.739 para 3.328
linhas (~11%) somando as quatro etapas.

**Modo apresentaÃ§Ã£o** (`src/components/oliam/presentation-mode.tsx`,
`usePresentationMode`): diferente do diÃ¡logo de junÃ§Ã£o, nÃ£o Ã©
totalmente autocontido â€” o overlay em tela cheia continua renderizando
`gridContent`/`sourceNotesPanel` (a mesma grade de widgets), que sÃ³
existem em `Dashboard`. O hook extrai os 4 estados, os dois
`useEffect` (tecla Esc, avanÃ§o automÃ¡tico) e sÃ³ a barra superior como
JSX (`presentationBar`); o wrapper externo e a injeÃ§Ã£o do conteÃºdo
continuam em `Dashboard`. `applyBookmark` continua definido em
`Dashboard` e Ã© passado como parÃ¢metro â€” ele mexe em `search`/`sort`,
estado que tambÃ©m pertence Ã  tela principal, nÃ£o Ã© exclusivo da
apresentaÃ§Ã£o.

**Editor de coluna calculada** (`formula-column-editor.tsx`,
`FormulaColumnEditor`): totalmente autocontido â€” recebe `columns` e
`onAddColumn`, decide sozinho quando mostrar o botÃ£o ou o formulÃ¡rio.

**Painel de marcadores** (`bookmark-panel.tsx`, `BookmarkPanel`):
tambÃ©m autocontido, recebe `bookmarks`/`onApply`/`onRemove`/`onSave`.
**Detalhe de comportamento preservado**: o painel tinha um `useEffect`
em `Dashboard` que fechava (`setBookmarkPanel(false)`) ao trocar de
aba/painel â€” como o estado de aberto/fechado agora Ã© interno ao
componente, isso nÃ£o Ã© mais controlÃ¡vel de fora. Resolvido com
`key={`${d.id}-${activeSheetIndex}`}` no `<BookmarkPanel>`: o React
remonta o componente (resetando todo estado interno, nÃ£o sÃ³
aberto/fechado) sempre que a aba ou o painel mudam â€” mesmo efeito
prÃ¡tico, sem precisar expor um controle externo que quebraria o
autocontenimento do componente.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros (pegou uma referÃªncia Ã³rfÃ£ a
`setBookmarkPanel` que sobrou de um `useEffect` de reset, corrigida
removendo a linha e usando a `key` acima em vez disso), Prettier
limpo, `npm run build` e `npm run performance:check` aprovados
(~423,2 KiB â€” teria estourado o limite antigo de 420 KiB, confirmando
que a decisÃ£o de subir para 450 KiB na etapa anterior foi necessÃ¡ria,
nÃ£o prematura). Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual pendente â€” os
trÃªs fluxos (apresentaÃ§Ã£o, coluna calculada, marcadores) nÃ£o foram
exercitados de verdade nesta sessÃ£o.

**O que ficou em `Dashboard`** (item 5 do plano da seÃ§Ã£o 51): busca/
filtro, exportaÃ§Ã£o, revisÃ£o de fundo, cÃ©lulas focadas, sinais de
qualidade, e toda a cadeia de `useMemo` do pipeline de dados + a
orquestraÃ§Ã£o da grade de widgets. Confirma a expectativa jÃ¡ registrada
na seÃ§Ã£o 51: mesmo depois de extrair os quatro blocos mais
autocontidos, o nÃºcleo de `Dashboard` continua grande â€” esta etapa
organiza e reduz risco para mudanÃ§as futuras, nÃ£o deixa o arquivo
"pequeno".

## 53. Dois bugs reais no clique-para-filtrar da barra, encontrados com o dev server funcionando ao vivo

O usuÃ¡rio reportou "clicar numa barra nÃ£o filtra do jeito que eu
queria" e, questionado, confirmou: **nada acontece** â€” sem filtro, sem
destaque, sem chip. Pela primeira vez nesta sessÃ£o o dev server ficou
estÃ¡vel tempo suficiente (depois de esperar a prÃ©-otimizaÃ§Ã£o de
dependÃªncias do Vite terminar antes de navegar, nÃ£o sÃ³ reiniciar o
preview) para investigar ao vivo, com `javascript_tool`/`computer`,
em vez de sÃ³ ler cÃ³digo.

**Bug 1 â€” o payload do `onClick` da `<Bar>` nÃ£o carrega `.name`
confiÃ¡vel.** O cÃ³digo antigo (`onClick={(pt) => pt?.name &&
handleGroupClick(groupCol.key, String(pt.name))}`) presumia que o
primeiro argumento entregue pelo Recharts a um `<Bar>` com `<Cell>`
filhas tem `.name` no nÃ­vel raiz â€” igual ao que `<Pie>` jÃ¡ fazia
funcionar com `(_, index) => setSelectedPieIndex(index)`, mas usando
Ã­ndice em vez de nome. Confirmado ao vivo: invocar a funÃ§Ã£o `onClick`
real (extraÃ­da via `element[Object.keys(element).find(k =>
k.startsWith('__reactProps$'))].onClick`) com o evento real do
Recharts nunca chamava `handleGroupClick` â€” instrumentado com um
`Array.prototype.find` monkey-patchado para detectar a chamada de
`toggleClickFilter`, zero chamadas. Corrigido usando o Ã­ndice (2Âº
argumento, comprovadamente correto) para buscar `barSeries[i].name`
diretamente â€” mesmo padrÃ£o jÃ¡ validado no `<Pie>`.

**Bug 2 â€” `setPointerCapture` incondicional no `pointerdown` quebra o
clique em qualquer grÃ¡fico rolÃ¡vel.** `handleChartScrollPointerDown`
(recurso de arrastar para rolar horizontalmente grÃ¡ficos com muitas
categorias) chamava `el.setPointerCapture(e.pointerId)` em todo
`pointerdown`, mesmo sem nenhum movimento â€” isso redireciona o alvo de
todo evento de ponteiro/clique seguinte para o container de rolagem
(`el`), nÃ£o para o elemento sob o cursor. Confirmado instrumentando um
listener em fase de captura: antes da correÃ§Ã£o, o `pointerup` e o
`click` de um clique parado (sem arrasto) chegavam com `target` igual
ao `<div>` de rolagem, nunca ao `<path>` da barra â€” o clique
literalmente nunca alcanÃ§ava o elemento com o `onClick`. Corrigido
adiando `setPointerCapture`/a classe `oliam-chart-dragging` para
dentro do `onMove`, sÃ³ quando o deslocamento realmente cruza o limiar
de 3px que jÃ¡ definia "isso Ã© um arrasto" â€” um clique parado nunca
aciona a captura, entÃ£o o clique segue seu caminho normal atÃ© a barra.
A supressÃ£o de clique-apÃ³s-arrasto (`stopPropagation` no `click`
seguinte a um arrasto de verdade) continua funcionando, agora liberando
a captura explicitamente no `pointerup` tambÃ©m.

Os dois bugs juntos explicam "nada acontece": mesmo se um dia o clique
alcanÃ§asse a barra (bug 2 corrigido primeiro isoladamente nÃ£o bastaria),
o handler ainda dependeria de um campo que nÃ£o existe no payload (bug
1). SÃ³ corrigir os dois juntos resolve. Confirmado ao vivo depois da
correÃ§Ã£o: clique numa barra do grÃ¡fico "Quantidade por linha de
Cliente" aplicou o filtro corretamente (`pointerdown`/`pointerup`/
`click` todos com `target: path.recharts-rectangle`), reduziu a base
de 300 para 16 linhas, mostrou o chip "Filtrado por: Amanda Barbosa" e
propagou para os outros widgets do painel (ranking "Top 5" tambÃ©m
mostrou o mesmo filtro) â€” cross-filter funcionando ponta a ponta.

Nenhum teste automatizado novo: a lÃ³gica corrigida Ã© inteiramente
sobre entrega de evento do navegador e payload do Recharts, sem funÃ§Ã£o
pura pÃºblica para testar isoladamente â€” mesma lacuna jÃ¡ registrada
para outros componentes de widget nesta sessÃ£o. A verificaÃ§Ã£o ao vivo
acima Ã© a prova disponÃ­vel.

Verificado com `npx vitest run` (471 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo, `npm run
build` e `npm run performance:check` aprovados (~423,3 KiB).

**Bugs adicionais encontrados durante a investigaÃ§Ã£o, ainda nÃ£o
corrigidos** (fora do escopo do pedido original, registrados para
decisÃ£o do usuÃ¡rio):

- Uma coluna chamada "Foto" (oculta da tabela principal, `kind:
  "NÃºmero"`, papel "Resultado", confianÃ§a 72% automÃ¡tica) virou
  `groupKey` de pelo menos dois widgets auto-gerados (`bar`/`pie`)
  apesar de nÃ£o aparecer em `groupableCols` â€” o seletor X do widget
  mostra a primeira opÃ§Ã£o da lista ("ID Venda") porque nenhuma opÃ§Ã£o
  bate com o `groupKey` real, enquanto o grÃ¡fico de fato agrupa por
  "Foto" (confirmado pelo `ChartReadingGuide`, "X Â· Foto"). Sintoma
  visÃ­vel: seletor e grÃ¡fico mostrando coisas diferentes, muito
  confuso. Causa provÃ¡vel: a classificaÃ§Ã£o de colunas do
  `auto-dashboard.ts` (dimensÃ£o vs. mÃ©trica) diverge da classificaÃ§Ã£o
  de `kind` usada em `groupableCols`/no painel "Colunas" â€” as duas nÃ£o
  sÃ£o a mesma fonte de verdade.
- A tabela dinÃ¢mica (`Matriz de Foto Ã— Cliente`) mostra "Total geral:
  0" com "CÃ¡lculo: MÃ©dia" sobre a mesma coluna "Foto" â€” consistente
  com ela ser numÃ©rica mas com valores que nÃ£o geram mÃ©dia Ãºtil
  (possÃ­vel: papel "Resultado" nÃ£o Ã© aditivo, e a mÃ©dia de um "Foto"
  provavelmente nÃ£o deveria ser o cÃ¡lculo padrÃ£o para esse tipo de
  coluna).

Ambos os achados apontam para o mesmo lugar: a coluna "Foto" tem uma
classificaÃ§Ã£o semÃ¢ntica que nÃ£o faz sentido para os usos que os
widgets automÃ¡ticos escolheram para ela. Vale investigar com o usuÃ¡rio
o que essa coluna realmente representa antes de decidir a correÃ§Ã£o
(esconder de seletores de agrupamento? mudar o papel/kind padrÃ£o?
mudar o cÃ¡lculo padrÃ£o para colunas com papel "Resultado"?).

## 54. Coluna sem nenhum valor preenchido nunca vira mÃ©trica/dimensÃ£o automÃ¡tica, e "Limpar filtros"

ContinuaÃ§Ã£o direta da seÃ§Ã£o 53: o usuÃ¡rio confirmou que "Foto" Ã© uma
coluna genuinamente vazia (checado ao vivo: os 12 primeiros valores da
tabela detalhada eram todos "â€”") e pediu explicitamente para nÃ£o
deixar colunas vazias virarem dado em widget nenhum, alÃ©m de "arrumar
o bug da pizza" e a navegaÃ§Ã£o de filtro ("filtro um nome lÃ¡ em cima no
grÃ¡fico de barras e nÃ£o consigo desfiltrar embaixo, por exemplo, no
grÃ¡fico de pizza").

**Causa raiz confirmada**: `classifyDashboardColumn`
(`auto-dashboard.ts`) classificava o papel de uma coluna sÃ³ pelo tipo
detectado (`kind`), nunca considerando se ela tinha algum valor de
verdade. Uma coluna 100% vazia com `kind: "nÃºmero"` virava role
`"metric"` exatamente como uma coluna numÃ©rica de verdade, disponÃ­vel
para `generateAutoDashboardPlan` usar como `valueKey`/`groupKey` de
qualquer widget automÃ¡tico â€” inclusive grÃ¡ficos de pizza e barra, e a
tabela dinÃ¢mica "Total geral: 0" da seÃ§Ã£o 53. O mesmo problema existia
em paralelo em `createWidget`/`buildDefaultWidgets` (`widgets.ts`): o
padrÃ£o de mÃ©trica de um widget novo (manual ou de painel legado) era
`nums[0]?.key`, a primeira coluna numÃ©rica da planilha, sem considerar
preenchimento.

**CorreÃ§Ã£o**: `classifyDashboardColumn` agora classifica role
`"unsupported"` sempre que `diagnostic.filled === 0`, antes de
qualquer outra checagem de tipo â€” isso exclui a coluna de `metrics`,
`dimensions` e `temporal` em `generateAutoDashboardPlan`, entÃ£o ela
nunca mais Ã© escolhida para nenhum widget automÃ¡tico, em nenhum dos
pontos do arquivo que iteram essas listas (nÃ£o foi preciso caÃ§ar cada
ocorrÃªncia individualmente). `createWidget`/`buildDefaultWidgets`
ganharam a mesma proteÃ§Ã£o: `nums` agora prioriza colunas numÃ©ricas com
`fillRatio(col, rows) > 0`, caindo no conjunto completo sÃ³ se
nenhuma coluna numÃ©rica tiver dado real (mesmo padrÃ£o de fallback jÃ¡
usado por `pickBestGroupColumn` para colunas quase vazias).

**Isso nÃ£o corrige retroativamente widgets jÃ¡ salvos** â€” o painel de
teste usado nesta sessÃ£o jÃ¡ tinha vÃ¡rios widgets configurados com
"Foto" antes da correÃ§Ã£o (persistidos no estado salvo do painel); eles
continuam assim atÃ© o usuÃ¡rio reconfigurar manualmente os seletores
X/Y ou recriar os widgets pelo botÃ£o "+ Widget". Confirmado ao vivo
que um widget de barra criado deliberadamente **depois** da correÃ§Ã£o
jÃ¡ usa "Quantidade" (coluna real) como padrÃ£o de Y, nÃ£o mais "Foto".

**"NÃ£o consigo desfiltrar"**: investigado â€” a barra de filtros globais
jÃ¡ existe (`routes/index.tsx`, renderizada sempre que `sheet.filters.length
> 0`, logo abaixo da barra de ferramentas, com um "Ã—" por filtro,
independente de qual widget estÃ¡ visÃ­vel na tela). O mecanismo jÃ¡
funciona; faltava um jeito rÃ¡pido de limpar tudo de uma vez quando
mais de um filtro se acumula de widgets diferentes (ex.: um filtro de
"Cliente" clicado na barra e um de "PaÃ­s" clicado no mapa, ambos
ativos ao mesmo tempo â€” remover sÃ³ um ainda deixa a base
filtrada, o que lÃª como "nÃ£o consigo desfiltrar"). Adicionado botÃ£o
"Limpar N filtros" (`setFilters([])`), visÃ­vel sÃ³ quando hÃ¡ mais de um
filtro ativo. Confirmado ao vivo: com 2 filtros ativos (Cliente +
PaÃ­s), o botÃ£o apareceu e o clique voltou a base para 300 de 300
linhas num passo sÃ³.

O "bug da pizza" relatado Ã© o mesmo widget mostrado na seÃ§Ã£o 53
(agrupado por "Foto", 300 categorias de fatias praticamente invisÃ­veis
â€” grÃ¡fico sem sentido para uma coluna vazia). A correÃ§Ã£o desta seÃ§Ã£o
impede que esse tipo de widget seja gerado automaticamente de novo;
nÃ£o foi criada nenhuma correÃ§Ã£o adicional especÃ­fica de renderizaÃ§Ã£o
da pizza, porque a causa raiz era inteiramente a escolha da coluna
errada, nÃ£o o componente do grÃ¡fico em si.

Dois testes novos: `classifyDashboardColumn` (`auto-dashboard.test.ts`)
cobre coluna 100% vazia (numÃ©rica e categÃ³rica) virando
`"unsupported"`, e coluna com pelo menos 1 valor preenchido
continuando classificaÃ§Ã£o normal; `createWidget`/`buildDefaultWidgets`
(`widgets.test.ts`) cobre o mesmo padrÃ£o "quase vazia"/"100% vazia"
jÃ¡ usado no teste existente de coluna quase vazia como agrupamento,
agora para o caso de mÃ©trica.

Verificado com `npx vitest run` (476 passou, 11 pulados, era 471 â€” 5
testes novos), `npx tsc --noEmit` sem erros, Prettier limpo, `npm run
build` e `npm run performance:check` aprovados (~423,5 KiB). Verificado
ao vivo no navegador: widget novo usa coluna preenchida como padrÃ£o de
mÃ©trica, e "Limpar filtros" resolve a base para o estado sem filtro em
um clique com mÃºltiplos filtros ativos.

## 55. ContinuaÃ§Ã£o da extraÃ§Ã£o do Dashboard: primeiro lote de painÃ©is autocontidos

Retomada do plano registrado na seÃ§Ã£o 51 (item 5, "reavaliar o que
sobra"). Um agente de exploraÃ§Ã£o mapeou o restante de `Dashboard`
(`routes/index.tsx`, ~1157 atÃ© o fim) em 18 candidatos a extraÃ§Ã£o,
ordenados por risco crescente â€” o mapeamento completo nÃ£o foi
transcrito aqui porque nÃ£o Ã© uma decisÃ£o de arquitetura duradoura, Ã©
um plano de trabalho consumido nesta e nas prÃ³ximas etapas. Resumo dos
achados de maior risco, que orientam a ordem das prÃ³ximas etapas:
exportaÃ§Ã£o (`useDashboardExport`) depende de `contentRef` criado em
`Dashboard`, o nÃºcleo de undo/redo Ã© hub de ~9 pontos de chamada de
`recordHistory()`, e as aÃ§Ãµes de widget (`traceException` etc.) cruzam
busca/filtro/foco/histÃ³rico ao mesmo tempo â€” nenhum dos trÃªs Ã©
recomendado antes dos candidatos mais simples estarem fora do caminho.

Esta etapa extrai os quatro candidatos de menor risco, todos
totalmente autocontidos (sÃ³ recebem props/callbacks, sem 1 remissÃ£o a
estado externo de `Dashboard` alÃ©m do que jÃ¡ Ã© passado):

- **`shortcuts-dialog.tsx`** (`ShortcutsDialog`): diÃ¡logo estÃ¡tico de
  atalhos de teclado, lista `SHORTCUTS` movida para dentro do arquivo.
- **`source-notes-panel.tsx`** (`SourceNotesPanel`): painel de
  observaÃ§Ãµes/comentÃ¡rios da planilha, recebe sÃ³ `sourceNotes`.
- **`version-diff-banner.tsx`** (`VersionDiffBanner`): banner de
  comparaÃ§Ã£o com a versÃ£o anterior, recebe sÃ³ `diff` (o `useMemo` que
  calcula `detailedVersionDiff` continua em `Dashboard`, pois tambÃ©m
  alimenta `SourceNotesPanel`/props do modo apresentaÃ§Ã£o).
- **`term-hint-banner.tsx`** (`useTermHint`): hook que devolve
  `termHintBanner` jÃ¡ pronto para renderizar; move o estado
  (`showTermHint`), o efeito que decide mostrar a dica (baseado em
  `sheet.widgets` conter algum tipo de widget agrupado) e
  `dismissTermHint` (grava `TERM_HINTS_KEY` no `localStorage`) para
  fora de `Dashboard`.

`index.tsx` caiu de 3.328 para 3.199 linhas nesta etapa. Dois imports
ficaram Ã³rfÃ£os depois do corte (`Info` de `lucide-react`,
`TERM_HINTS_KEY` de `@/lib/storage`) e foram removidos â€” o projeto
desliga `@typescript-eslint/no-unused-vars`, entÃ£o isso nÃ£o vira erro
de lint, sÃ³ limpeza de legibilidade feita manualmente conferindo
contagem de ocorrÃªncias de cada identificador.

Verificado com `npx vitest run` (476 passou, 11 pulados, mesma
contagem â€” reorganizaÃ§Ã£o estrutural pura, nenhum comportamento
mudou), `npx tsc --noEmit` sem erros, Prettier limpo (depois de
ajustar uma quebra de linha em `term-hint-banner.tsx` para bater com o
formatador), `npm run build` e `npm run performance:check` aprovados
(maior chunk genÃ©rico ~428,6 KiB, dentro do limite de 450 KiB â€” mesma
fragilidade de "fachada de chunk compartilhado" jÃ¡ registrada nas
seÃ§Ãµes 36/42/51, sem surpresa). Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual
das etapas anteriores: os quatro componentes nÃ£o foram exercitados ao
vivo no navegador nesta etapa (baixo risco por serem puramente
apresentacionais/prop-driven, sem lÃ³gica nova).

PrÃ³ximas etapas seguem o mapeamento acima, em ordem de risco
crescente: painÃ©is "quase autocontidos" (regras ausentes, formataÃ§Ã£o,
sinais de qualidade, chips de filtro), depois os blocos com mais
props (painel de colunas com drag-and-drop, sidebars, paleta de
comandos), deixando exportaÃ§Ã£o, undo/redo e aÃ§Ãµes de widget por
Ãºltimo, como jÃ¡ recomendado.

## 56. Segundo lote da extraÃ§Ã£o do Dashboard: regras ausentes, formataÃ§Ã£o, sinais de qualidade, chips de filtro

ContinuaÃ§Ã£o direta da seÃ§Ã£o 55, mesma branch (PR ainda nÃ£o mesclado â€”
empilhado para evitar o conflito de merge conhecido neste arquivo
append-only). Extrai os quatro candidatos "quase autocontidos"
seguintes do mapeamento, todos recebendo sÃ³ props/callbacks jÃ¡
calculados em `Dashboard`, sem estado prÃ³prio de UI compartilhado:

- **`missing-rules-panel.tsx`** (`MissingRulesPanel`): painel "Regras
  de dados ausentes", recebe `columns`/`setColumns`.
- **`format-panel.tsx`** (`FormatPanel`): painel de formataÃ§Ã£o
  condicional, wrapper de `FormatRulesEditor` (jÃ¡ extraÃ­do na seÃ§Ã£o
  36) por coluna numÃ©rica; recebe `nums`/`columns`/`setColumns`. O
  import de `FormatRulesEditor` em `index.tsx` ficou Ã³rfÃ£o depois
  desta extraÃ§Ã£o e foi removido.
- **`quality-signals-panel.tsx`** (`QualitySignalsPanel`): painel
  "Qualidade dos dados"; recebe `visibleSignals`/`onDismiss`. O
  contador no botÃ£o do toolbar (badge com `visibleSignals.length`)
  continua em `Dashboard`, jÃ¡ que `visibleSignals` tambÃ©m alimenta
  esse badge fora do painel â€” nÃ£o Ã© um estado que "vaza", Ã© um valor
  jÃ¡ calculado consumido em dois lugares.
- **`filter-chips-bar.tsx`** (`FilterChipsBar`): barra de chips de
  filtros ativos com o botÃ£o "Limpar N filtros" (seÃ§Ã£o 54); recebe
  `filters`/`columns`/`setFilters`. Confirmado por leitura: os dois
  tipos de `<input>` jÃ¡ tinham `autoFocus` incondicional antes da
  extraÃ§Ã£o (nÃ£o Ã© condicional por Ã­ndice), entÃ£o mover o JSX nÃ£o muda
  esse comportamento.

`index.tsx` caiu de 3.199 para 3.020 linhas nesta etapa. Nenhum
comportamento mudou â€” os quatro componentes sÃ£o puramente
apresentacionais/prop-driven sobre estado que continua em `Dashboard`
(`missingPanel`, `formatPanel`, `qualityPanel`, `dismissedSignals`,
`sheet.filters`).

Verificado com `npx vitest run` (476 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo (duas quebras
de linha ajustadas para bater com o formatador, em
`filter-chips-bar.tsx` e no JSX de `FilterChipsBar` em `index.tsx`),
`npm run build` e `npm run performance:check` aprovados (maior chunk
genÃ©rico ~434,2 KiB, dentro do limite de 450 KiB â€” margem restante de
~15,8 KiB antes de precisar reabrir a decisÃ£o de orÃ§amento ou investir
em `rollup-plugin-visualizer`). Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual
das etapas anteriores: os quatro painÃ©is nÃ£o foram exercitados ao vivo
no navegador nesta etapa.

Restam do mapeamento da seÃ§Ã£o 55, por risco crescente: painel de
colunas com drag-and-drop, sidebar de navegaÃ§Ã£o, sidebar de insights,
paleta de comandos, hook de revisÃ£o em segundo plano, e por Ãºltimo
exportaÃ§Ã£o, undo/redo e aÃ§Ãµes de widget (os trÃªs mais entrelaÃ§ados
entre si).

## 57. Terceiro lote da extraÃ§Ã£o do Dashboard: painel de colunas com drag-and-drop

ContinuaÃ§Ã£o direta da seÃ§Ã£o 56, mesma branch. Extrai o candidato de
risco mÃ©dio seguinte do mapeamento: **`column-panel.tsx`**
(`ColumnPanel`) â€” painel "Colunas e significado", com reordenaÃ§Ã£o por
arrastar (`draggable`/`onDragStart`/`onDrop`, texto = Ã­ndice de
origem), toggle de visibilidade, ediÃ§Ã£o de papel/unidade semÃ¢ntica
(`setSemanticOverride`/`resetSemanticOverride`) e o
`FormulaColumnEditor` (jÃ¡ extraÃ­do na seÃ§Ã£o 36) embutido no rodapÃ©.

O ponto de atenÃ§Ã£o do mapeamento era o `e.dataTransfer.setData` duplo
usado para arrastar uma coluna tanto para reordenar dentro da lista
quanto para um slot de campo de grÃ¡fico fora do painel
(`columnDragType(c.kind)`, ver `widgets.ts`) â€” preservado
integralmente, sem alterar nenhuma chamada de `dataTransfer`.

`ColumnPanel` recebe `columns`/`setColumns`/`semanticProfilesByKey`/
`semanticOverrides`/`setSemanticOverride`/`resetSemanticOverride`, sem
estado prÃ³prio. `index.tsx` caiu de 3.020 para 2.855 linhas. Seis
imports ficaram Ã³rfÃ£os e foram removidos: `Calculator`, `ChevronDown`,
`ChevronUp`, `GripVertical` (Ã­cones), `columnDragType` (`widgets.ts`),
`kinds`, `semanticRoleLabels`, `semanticUnitOptions`
(`spreadsheet-intelligence.ts`) e o import direto de
`FormulaColumnEditor` (agora sÃ³ usado dentro de `column-panel.tsx`).

Verificado com `npx vitest run` (476 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo (uma
assinatura de funÃ§Ã£o quebrada em mÃºltiplas linhas para bater com o
formatador), `npm run build` e `npm run performance:check` aprovados
â€” **maior chunk genÃ©rico em ~438,0 KiB, margem de sÃ³ ~12 KiB antes do
limite de 450 KiB**. Mesma limitaÃ§Ã£o de verificaÃ§Ã£o visual das etapas
anteriores: o drag-and-drop de colunas nÃ£o foi exercitado ao vivo
nesta etapa (risco considerado baixo â€” nenhuma linha de lÃ³gica de
`dataTransfer` foi reescrita, sÃ³ movida).

**Margem de orÃ§amento ficou crÃ­tica de novo**, mesmo padrÃ£o jÃ¡
registrado nas seÃ§Ãµes 42/51/56: mover cÃ³digo sem mudar comportamento
ainda assim desloca qual mÃ³dulo vira a "fachada" do chunk
compartilhado. Os prÃ³ximos candidatos do mapeamento da seÃ§Ã£o 55
(sidebars, paleta de comandos, ~75-190 linhas cada) tÃªm risco real de
estourar o limite de 450 KiB nesta margem. DecisÃ£o registrada para o
usuÃ¡rio antes de continuar: aumentar o limite de novo, investir em
`rollup-plugin-visualizer` para entender a causa raiz, ou pausar a
extraÃ§Ã£o estrutural nesta branch.

## 58. InvestigaÃ§Ã£o real do grafo de dependÃªncias do chunk compartilhado

O usuÃ¡rio escolheu investigar a causa raiz em vez de sÃ³ subir o limite
de novo (opÃ§Ã£o jÃ¡ recomendada, mas nunca executada, desde a seÃ§Ã£o 51).

**Ferramenta usada**: `rollup-plugin-visualizer` foi instalado
temporariamente (`npm install --save-dev`), usado uma vez para gerar
o relatÃ³rio, depois **desinstalado** â€” a saÃ­da HTML/JSON padrÃ£o do
plugin mistura o build do cliente com o build SSR do Nitro (a mesma
invocaÃ§Ã£o de `vite build` produz os dois; o plugin sobrescreve o
relatÃ³rio entre um e outro porque nÃ£o distingue destino de saÃ­da,
entÃ£o o relatÃ³rio final refletia sempre o build SSR, nÃ£o o client
bundle medido por `performance:check`). Em vez de adicionar uma
dependÃªncia para contornar essa limitaÃ§Ã£o, `vite.config.ts` ganhou um
plugin mÃ­nimo escrito Ã  mÃ£o (`clientChunkReportPlugin`, ativado sÃ³ com
`ANALYZE=1`, sem custo em builds normais): usa o hook `generateBundle`
do Rollup, filtra por `options.dir.includes("static")` (a saÃ­da do
cliente fica em `.vercel/output/static/assets`; a saÃ­da SSR em
`.vercel/output/functions/__server.func`) e escreve
`client-chunk-report.json` (gitignored) com cada chunk do cliente e o
tamanho renderizado de cada mÃ³dulo dentro dele.

**Achado real**: o chunk hoje nomeado `column-panel-*.js` (438,0 KiB)
**nÃ£o Ã© dominado pelo arquivo que lhe dÃ¡ nome** â€” `column-panel.tsx`
contribui sÃ³ 7,1 KiB dos 436,2 KiB do chunk. A composiÃ§Ã£o real, por
mÃ³dulo, maior primeiro:

- `widget-card.tsx`: 130,6 KiB (o maior componente do projeto â€” corpo
  de `WidgetCard`/`EmptyWidget` com um bloco de renderizaÃ§Ã£o por tipo
  de widget: barra, pizza, linha, mapa, tabela, cronograma etc.)
- `import.ts`: 64,5 KiB
- `tailwind-merge` (node_modules): 54,6 KiB
- `review.tsx`: 40,1 KiB
- `@tanstack/virtual-core` (node_modules): 35,8 KiB
- `widget-support.tsx`: 34,6 KiB
- mais 157 outros mÃ³dulos, a maioria arquivos de primeira parte de
  `src/lib/` e `src/components/oliam/`, nenhum isolado acima de 25 KiB

**ConclusÃ£o**: a "fachada do chunk" nunca foi o problema real â€” Ã© sÃ³ o
nome cosmÃ©tico que o Rolldown atribui a um chunk que de qualquer forma
concentra quase todo o cÃ³digo de primeira parte compartilhado entre as
rotas `/` e `/painel/$id`, porque quase todo esse cÃ³digo *Ã©*
genuinamente compartilhado (importado de ambas as rotas, direta ou
transitivamente, atravÃ©s de `Dashboard`/`WidgetCard`). Reorganizar
arquivos mexe em qual mÃ³dulo "ganha" o nome do chunk (por isso a
oscilaÃ§Ã£o do nome a cada PR desta sÃ©rie), mas nÃ£o move nenhum byte
para fora do chunk nem para dentro â€” o grafo de dependÃªncias lÃ³gico Ã©
o mesmo antes e depois de cada extraÃ§Ã£o. Isso confirma, com dado real
em vez de hipÃ³tese, a decisÃ£o jÃ¡ registrada na seÃ§Ã£o 51 e a liÃ§Ã£o da
tentativa revertida de isolar `widget-card`/`widget-support` (mesma
seÃ§Ã£o): tentar isolar por regra de `id.includes(...)` nÃ£o reduz o
total, sÃ³ realoca os mesmos bytes para outro chunk nomeado
diferente â€” e um `manualChunks` que tentasse isolar `widget-card.tsx`
sozinho reproduziria exatamente o problema jÃ¡ visto (777 KiB) porque
ele mesmo puxa a maior parte do resto do grafo.

**ConsequÃªncia prÃ¡tica para o orÃ§amento**: a extraÃ§Ã£o estrutural em
andamento nesta branch (mover cÃ³digo entre `index.tsx` e
`components/oliam/`) Ã© neutra para o tamanho deste chunk â€” o cÃ³digo
nÃ£o desaparece nem cresce, sÃ³ troca de arquivo dentro do mesmo grafo
compartilhado. A oscilaÃ§Ã£o do maior chunk genÃ©rico entre PRs (423,5 â†’
428,6 â†’ 434,2 â†’ 438,0 KiB) nÃ£o Ã© causada pela extraÃ§Ã£o em si; Ã©
crescimento real de funcionalidade acumulado ao longo de vÃ¡rias
sessÃµes (iniciativa de widgets explicativos, widget "Insights
automÃ¡ticos", "Limpar filtros" etc.), que a extraÃ§Ã£o apenas expÃµe ao
deslocar a fachada. **Continuar a extraÃ§Ã£o estrutural nÃ£o Ã© o que
ameaÃ§a estourar o orÃ§amento** â€” Ã© o crescimento de `widget-card.tsx`
(o mÃ³dulo individual mais pesado do projeto) e do resto do cÃ³digo
genuinamente compartilhado que precisaria de uma reduÃ§Ã£o real (ex.:
`import()` dinÃ¢mico por tipo de widget, carregando sÃ³ o corpo de
renderizaÃ§Ã£o do tipo realmente usado no painel) para diminuir de
verdade â€” trabalho de escopo prÃ³prio, nÃ£o uma reorganizaÃ§Ã£o de
arquivos.

**Ferramenta mantida para o futuro**: `clientChunkReportPlugin` fica
em `vite.config.ts`, sem custo em build normal (sÃ³ ativa com
`ANALYZE=1 npm run build`), para a prÃ³xima vez que o orÃ§amento
apertar. Nenhuma dependÃªncia nova foi mantida no projeto.

Verificado com `npx tsc --noEmit` sem erros, Prettier limpo, `npm run
build` e `npm run performance:check` aprovados sem mudanÃ§a de tamanho
(a mudanÃ§a em `vite.config.ts` sÃ³ adiciona um plugin condicional a uma
env var ausente em builds normais â€” confirmado comparando o build
antes/depois da mudanÃ§a, mesmo tamanho de chunk em ambos). `npx vitest
run` nÃ£o foi afetado (476 passou, 11 pulados, sem relaÃ§Ã£o com
`vite.config.ts`).

## 59. Quarto lote da extraÃ§Ã£o do Dashboard: sidebars e paleta de comandos

ContinuaÃ§Ã£o direta da seÃ§Ã£o 58, mesma branch. Com o achado da
investigaÃ§Ã£o confirmado (extraÃ§Ã£o nÃ£o move bytes para dentro/fora do
chunk compartilhado), o usuÃ¡rio optou por continuar com os trÃªs
candidatos de risco mÃ©dio seguintes do mapeamento da seÃ§Ã£o 55:

- **`dashboard-nav-sidebar.tsx`** (`DashboardNavSidebar`): sidebar
  esquerda de navegaÃ§Ã£o entre painÃ©is (lista ordenada por
  `updatedAt`, botÃ£o "Novo painel", atalho para "Regras de dados
  ausentes"). Recebe `dashboards`/`activeId`/`openDash`/`backHome`/
  `newDash`/`rowCount`/`onOpenMissingPanel`; o estado `sidebar`
  (aberto/fechado) continua em `Dashboard`, jÃ¡ que tambÃ©m controla o
  botÃ£o de alternar no cabeÃ§alho.
- **`insight-sidebar.tsx`** (`InsightSidebar`): sidebar direita com
  visÃ£o geral, dashboard sugerido, KPIs, ranking clicÃ¡vel (clique-
  para-filtrar) e filtro de intervalo de data. Recebe uma lista longa
  de props jÃ¡ calculadas no pipeline de `Dashboard` (`data`,
  `autoDashboard`, `nums`, `versionDelta`, `sidebarRanking`,
  `sidebarRankingMax`, `cat`, `primary`, `dateCol`, `filters`,
  `setFilters`), sem estado prÃ³prio.
- **`command-palette.tsx`** (`CommandPalette`): `CommandDialog` (âŒ˜K)
  com ~20 aÃ§Ãµes. Recebe cada callback jÃ¡ pronto (undo/redo,
  exportaÃ§Ãµes, abrir painÃ©is, tema, navegaÃ§Ã£o) â€” puro wiring, sem
  lÃ³gica nova; os mesmos callbacks continuam sendo passados tambÃ©m
  para os botÃµes da barra de ferramentas, entÃ£o a extraÃ§Ã£o nÃ£o
  duplicou nenhuma funÃ§Ã£o, sÃ³ a referÃªncia jÃ¡ existente.

`index.tsx` caiu de 2.855 para 2.523 linhas. VÃ¡rios imports ficaram
Ã³rfÃ£os e foram removidos: Ã­cones (`ChevronLeft`, `Pin`, `Activity`,
`Moon`, `Sun`, `LayoutGrid`, e os seis componentes `Command*` de
`@/components/ui/command`) e funÃ§Ãµes (`hue`, `conditionalStyle`,
`conditionalColor`, `fmt` de `@/lib/format`).

Verificado com `npx vitest run` (476 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo de primeira
(sem ajuste manual de quebra de linha desta vez), `npm run build` e
`npm run performance:check` aprovados â€” **mas com margem agora crÃ­tica
de verdade: ~447,2 KiB de 450 KiB, sÃ³ ~2,8 KiB de folga**. O tamanho
subiu mais do que o esperado pela investigaÃ§Ã£o da seÃ§Ã£o 58 (que previa
neutralidade): a explicaÃ§Ã£o provÃ¡vel Ã© overhead de mÃ³dulo por arquivo
novo (cada arquivo extra tem seu prÃ³prio wrapper ESM no bundle), nÃ£o
uma contradiÃ§Ã£o do achado â€” o *conteÃºdo* do chunk continua sendo o
mesmo grafo compartilhado, mas cada extraÃ§Ã£o adiciona uma fraÃ§Ã£o de
bytes de boilerplate de mÃ³dulo que se acumula. Mesma limitaÃ§Ã£o de
verificaÃ§Ã£o visual das etapas anteriores: as trÃªs extraÃ§Ãµes nÃ£o foram
exercitadas ao vivo no navegador nesta etapa.

**Margem esgotada**: os candidatos restantes do mapeamento da seÃ§Ã£o 55
(hook de revisÃ£o em segundo plano, ~55 linhas; exportaÃ§Ã£o, ~260
linhas; undo/redo, ~65 linhas; aÃ§Ãµes de widget, ~130 linhas) nÃ£o tÃªm
mais espaÃ§o nesta margem sem decisÃ£o explÃ­cita do usuÃ¡rio â€” mesmo o
hook menor (~55 linhas) Ã© arriscado com sÃ³ 2,8 KiB de folga. Pausado
aqui para decisÃ£o: subir o limite de novo, ou parar a extraÃ§Ã£o
estrutural nesta branch e publicar o que jÃ¡ foi feito.

## 60. Bug real do grÃ¡fico de pizza quebrado visualmente com colunas de alta cardinalidade

O usuÃ¡rio reportou com uma captura de tela: um widget de pizza
agrupado por "ID Venda" (identificador quase Ãºnico por linha)
renderizava um emaranhado de traÃ§os finos saindo do centro em vez de
um cÃ­rculo â€” nada a ver com uma pizza. Pedido explÃ­cito de incluir a
correÃ§Ã£o neste PR antes do merge (mesma branch de extraÃ§Ã£o do
Dashboard, ainda nÃ£o mesclada).

**Causa raiz confirmada por leitura de cÃ³digo, depois reproduzida ao
vivo**: `pieSeries` em `widget-card.tsx` jÃ¡ tinha uma lÃ³gica de
colapso "Top 5 + Outros" para nÃ£o estourar o `<Pie>` do Recharts com
muitas categorias â€” mas ela era **pulada inteiramente** quando
`dataMode === "raw"` (modo "linha a linha"): `if (dataMode === "raw")
return series;`. Como um widget de pizza novo com operaÃ§Ã£o diferente
de contagem **jÃ¡ nasce em modo raw por padrÃ£o**
(`w.dataMode ?? (op === "count" ? "aggregate" : "raw")`), qualquer
pizza criada com uma coluna de agrupamento de alta cardinalidade (ID
Ãºnico, cÃ³digo, etc.) cai direto nesse caminho sem proteÃ§Ã£o. Em modo
raw, `chartSeries` gera **uma fatia por linha da planilha** (nÃ£o por
categoria), e um cap prÃ©-existente de 120 (`limitChartSeriesForRendering`)
amostrava atÃ© 120 pontos distribuÃ­dos â€” mas mesmo 120 fatias
individuais, com Ã¢ngulos de preenchimento fixos (`paddingAngle`
calculado por `pieRoundnessFor`), quebram visualmente o desenho do
Recharts. O texto "PrÃ©via otimizada: 120 de 300 pontos..." visÃ­vel na
captura do usuÃ¡rio Ã© exatamente esse cap em aÃ§Ã£o, mascarando o
problema real em vez de preveni-lo.

**CorreÃ§Ã£o**: a lÃ³gica de colapso "Top 5 + Outros" (jÃ¡ existente e
correta para o modo agregado) passou a rodar **sempre**, extraÃ­da
para uma funÃ§Ã£o pura nova, `collapsePieSeries` (`data-pipeline.ts`,
ao lado de `pieRoundnessFor`/`pieComparisonFor`), e aplicada sobre
`completeSeries` â€” a lista completa e nÃ£o amostrada â€” em vez do
`series` jÃ¡ cortado em 120. Isso Ã© estritamente melhor que colapsar
depois da amostragem: o "Top 5" real (as 5 maiores linhas por valor)
Ã© calculado sobre todos os dados, nÃ£o sobre uma amostra distribuÃ­da
que poderia nem conter as maiores linhas. Como consequÃªncia, o cap
especial de 120 exclusivo do modo raw do pizza (`renderableSeries`)
deixou de ser necessÃ¡rio e foi removido â€” o pizza nunca mais amostra,
sempre colapsa para no mÃ¡ximo 6 fatias de verdade, entÃ£o o banner
"PrÃ©via otimizada" (compartilhado com barra/linha/Ã¡rea) tambÃ©m deixa
de aparecer para pizza, o que Ã© correto: nÃ£o hÃ¡ mais nada "otimizado
por amostragem" para anunciar.

Teste de regressÃ£o novo em `data-pipeline.test.ts`
(`describe("collapsePieSeries")`): sÃ©rie com 6 categorias ou menos
passa intacta; sÃ©rie com mais de 6 vira top 5 + "Outros" com `count`
correto; caso que reproduz o relatado (120 entradas "linha a linha"
com nomes quase Ãºnicos, imitando um `sourceRow` por linha) confirma
que o resultado nunca passa de 6 itens e sempre termina em "Outros";
caso em que o resto soma zero confirma que "Outros" nÃ£o aparece Ã  toa.

**Verificado ao vivo no navegador**, reproduzindo o cenÃ¡rio exato do
usuÃ¡rio: dados colados com coluna "ID Venda" (120 valores quase
Ãºnicos) e "Quantidade" numÃ©rica, widget de pizza criado manualmente
com X: ID Venda, Y: Quantidade â€” nasceu em modo "linha a linha" como
esperado. Antes da correÃ§Ã£o isso geraria as mesmas ~120 fatias
quebradas da captura do usuÃ¡rio; depois da correÃ§Ã£o, a legenda do
widget mostra exatamente 6 itens (5 maiores linhas individuais +
"Outros" com "115 categorias agrupadas Â· 92,7%"), confirmando que o
colapso estÃ¡ ativo tambÃ©m em modo raw. A ferramenta de screenshot
deste sandbox continua bloqueada (RAF nÃ£o dispara, limitaÃ§Ã£o jÃ¡
registrada nas seÃ§Ãµes 26/41), entÃ£o a confirmaÃ§Ã£o visual foi feita
pela Ã¡rvore de acessibilidade da pÃ¡gina (lista da legenda, contagens
e rÃ³tulos), nÃ£o por captura de tela â€” mas Ã© uma prova direta do DOM
renderizado, nÃ£o inferÃªncia de cÃ³digo.

Verificado com `npx vitest run` (480 passou, 11 pulados, era 476 â€” 4
testes novos), `npx tsc --noEmit` sem erros, Prettier limpo (uma
aspa dupla dentro de uma string de teste trocada por aspa simples
pra bater com o formatador), `npm run build` e `npm run
performance:check` aprovados (~447,1 KiB, dentro do limite de 450
KiB, sem mudanÃ§a relevante de tamanho â€” a correÃ§Ã£o remove cÃ³digo, nÃ£o
adiciona).

## 61. Segunda causa do bug da pizza: fatias finas demais para serem vistas, mesmo jÃ¡ colapsadas

Depois do PR da seÃ§Ã£o 60 mesclado, o usuÃ¡rio testou de novo e reportou
que a pizza "continua extremamente bugada". A captura de tela desta
vez nÃ£o mostrava mais o emaranhado de espinhos (a correÃ§Ã£o anterior
estÃ¡ funcionando â€” confirmado pela Ã¡rvore de acessibilidade: sÃ³ 6
categorias visÃ­veis, "PosiÃ§Ã£o 5 de 6"), mas um anel quase de uma cor
sÃ³, com a legenda mostrando 4-5 categorias de cores diferentes que nÃ£o
apareciam distinguÃ­veis no desenho.

**Causa raiz**: quando o "Top 5" tem participaÃ§Ã£o muito pequena do
total (ex.: 0,6% cada, num painel com uma cauda longa grande somada em
"Outros"), o Ã¢ngulo de cada fatia jÃ¡ fica abaixo de ~2Â°, e o
`paddingAngle` (definido por `pieRoundnessFor` para reduzir a 1Â° nesse
caso) consome a maior parte do que sobra â€” o arco visÃ­vel de cada
fatia do "Top 5" fica com menos de 1,5Â° de largura, virtualmente
imperceptÃ­vel num cÃ­rculo de ~150px de raio (poucos pixels de arco).
A legenda continua correta (cada item recebe uma cor distinta de
`pieLegendItems`), mas o desenho nÃ£o consegue mostrar essa cor porque
a fatia Ã© fina demais â€” nÃ£o Ã© a mesma causa do bug anterior (que
mandava dezenas/centenas de fatias sem colapsar), Ã© uma segunda
limitaÃ§Ã£o que sÃ³ aparece depois que o colapso jÃ¡ estÃ¡ funcionando e a
cauda longa Ã© grande o suficiente para dominar o total.

**CorreÃ§Ã£o**: `<Pie>` do Recharts tem uma prop dedicada exatamente
para esse cenÃ¡rio, `minAngle`, que nunca tinha sido configurada.
Adicionado `minAngle={4}` ao `<Pie>` em `widget-card.tsx` â€” garante
que toda fatia, por menor que seja sua participaÃ§Ã£o real, sempre
recebe pelo menos 4Â° de arco visÃ­vel, sem alterar a lÃ³gica de colapso
da seÃ§Ã£o 60 nem os valores/porcentagens exibidos no tooltip/legenda
(que continuam refletindo a proporÃ§Ã£o real, nÃ£o o Ã¢ngulo ajustado â€”
`minAngle` sÃ³ afeta o desenho, nÃ£o os nÃºmeros).

Verificado ao vivo no navegador reabrindo o mesmo painel de teste da
seÃ§Ã£o 60 (persistido em IndexedDB entre as duas etapas): a Ã¡rvore de
acessibilidade confirma 6 elementos de fatia renderizados no SVG do
grÃ¡fico (consistente com as 6 categorias do colapso) e a legenda/
comparaÃ§Ã£o continuam corretas. A verificaÃ§Ã£o pixel a pixel do Ã¢ngulo
mÃ­nimo continua bloqueada pela mesma limitaÃ§Ã£o de sandbox das seÃ§Ãµes
26/41/60 (RAF nÃ£o dispara, screenshot indisponÃ­vel) â€” `minAngle` Ã© uma
prop padrÃ£o e documentada do Recharts, comportamento nÃ£o foi
reimplementado Ã  mÃ£o.

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem â€” mudanÃ§a de uma prop visual, sem lÃ³gica nova para testar),
`npx tsc --noEmit` sem erros, Prettier limpo, `npm run build` e `npm
run performance:check` aprovados (~447,2 KiB, sem mudanÃ§a relevante
de tamanho).

## 62. Clique-para-filtrar da pizza agora filtra na hora, igual ao resto dos grÃ¡ficos

O usuÃ¡rio pediu explicitamente, depois de validar as duas correÃ§Ãµes
das seÃ§Ãµes 60/61: "quero que todos faÃ§am ao clicar" â€” todo grÃ¡fico com
dimensÃ£o de agrupamento deveria filtrar o painel inteiro com um clique
sÃ³, como jÃ¡ acontecia na barra, sem precisar de um botÃ£o extra
"Filtrar por tal coisa".

**Auditoria de todos os widgets com dimensÃ£o de agrupamento**
(`widget-card.tsx`): barra (`onClick` da `<Bar>`), linha e Ã¡rea
(`ChartDot.onClick` â†’ `onSelect`), ranking (`onClick` de cada linha) e
mapa (`marker.on("click")` â†’ `onSelect`) jÃ¡ chamavam `handleGroupClick`
diretamente ao clicar, filtrando o painel inteiro na hora â€” confirmado
lendo cada bloco, nÃ£o sÃ³ por inferÃªncia. **SÃ³ a pizza era a exceÃ§Ã£o**:
o `onClick` do `<Pie>` e o `onSelectIndex` da legenda sÃ³ chamavam
`setSelectedPieIndex`, que apenas atualiza qual fatia aparece
destacada no `SeriesComparisonPanel` â€” filtrar de verdade exigia um
segundo clique no botÃ£o "Filtrar por esta fatia" dentro desse painel.

**CorreÃ§Ã£o**: o `onClick` do `<Pie>` e o `onSelectIndex` de
`PieLegend` agora chamam `handleGroupClick` tambÃ©m, na mesma funÃ§Ã£o
que jÃ¡ seleciona (nÃ£o sÃ£o dois caminhos concorrentes, Ã© a mesma aÃ§Ã£o
fazendo as duas coisas). Guarda preservada: clicar em "Outros" (o
agrupador sintÃ©tico do colapso da seÃ§Ã£o 60, sem valor real na
planilha) continua sÃ³ selecionando, sem tentar filtrar por um nome que
nÃ£o existe em nenhuma linha â€” mesma regra que jÃ¡ existia no botÃ£o do
`SeriesComparisonPanel` (`onFilter` vira `undefined` quando
`selectedPie.name === "Outros"`). O botÃ£o "Filtrar por esta fatia"
continua existindo, agora redundante com o clique direto na maioria
dos casos, mas Ãºtil para quem sÃ³ passou o mouse (hover) sem clicar, ou
para telas sensÃ­veis ao toque onde a fatia Ã© pequena demais para
acertar com precisÃ£o.

Verificado ao vivo no navegador, reabrindo o mesmo painel de teste
persistido das seÃ§Ãµes 60/61: clicar em "Filtrar por V00013" na legenda
da pizza reduziu a base de 120 para 1 linha, mostrou o chip "Filtrado
por: V00013" na barra de ferramentas, e propagou para os KPIs da
sidebar (478 â†’ 7) e para o ranking (lista completa â†’ sÃ³ V00013) â€”
cross-filter ponta a ponta, mesmo padrÃ£o jÃ¡ confirmado pela barra na
seÃ§Ã£o 53. Clicar de novo no botÃ£o "Remover filtro" desfez tudo,
voltando a 120 de 120 linhas, confirmando o toggle (`toggleClickFilter`)
funcionando tambÃ©m pela pizza.

Nenhum outro widget com o mesmo padrÃ£o "seleciona mas nÃ£o filtra" foi
encontrado na auditoria â€” os Ãºnicos estados `setSelected*`/`setActive*`
em `widget-card.tsx` sÃ£o o par hover/seleÃ§Ã£o da pizza (agora corrigido)
e o hover da barra (`activeBarIndex`, que nunca precisou de correÃ§Ã£o
porque a barra jÃ¡ filtra direto no clique, sem depender desse estado).
Tabela dinÃ¢mica e matriz de cruzamento (`pivot-table`/`matrix-heatmap`)
nÃ£o tÃªm nenhuma interaÃ§Ã£o de clique hoje â€” sÃ£o tabelas, nÃ£o grÃ¡ficos
com dimensÃ£o de agrupamento clicÃ¡vel, fora do escopo deste pedido.

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem â€” mudanÃ§a de comportamento de clique, sem funÃ§Ã£o pura nova
para testar; mesma lacuna jÃ¡ registrada para outros componentes de
widget nesta sessÃ£o), `npx tsc --noEmit` sem erros, Prettier limpo,
`npm run build` e `npm run performance:check` aprovados (~447,3 KiB,
sem mudanÃ§a relevante de tamanho).

## 63. Carregamento sob demanda dos widgets de nicho: margem real de orÃ§amento, nÃ£o emprestada

Retomando a recomendaÃ§Ã£o registrada ao final da seÃ§Ã£o 61: em vez de
continuar a extraÃ§Ã£o estrutural do Dashboard subindo o limite do
orÃ§amento de novo (empurrando o problema, como jÃ¡ tinha acontecido
antes), o usuÃ¡rio autorizou investir em reduzir o tamanho real do
chunk compartilhado primeiro.

**Descartado**: extrair os blocos `if (w.type === "schedule-heatmap")`
(~580 linhas) e `if (w.type === "exception-panel")` (~380 linhas) de
dentro de `WidgetCard` para lazy-load, por serem os maiores candidatos
Ã³bvios. DecisÃ£o consciente de nÃ£o fazer isso nesta etapa: nenhum dos
dois Ã© um componente autocontido hoje â€” cada um depende de dezenas de
variÃ¡veis computadas no topo de `WidgetCard` (`dragProps`,
`sizeControls`, `FilterChip`, `handleGroupClick` etc.), sem nenhum
teste automatizado de UI cobrindo o resultado visual, e sem forma
confiÃ¡vel de verificar visualmente neste sandbox (RAF/screenshot
bloqueados). Extrair ~580 linhas de lÃ³gica de cronograma manualmente,
sem rede de seguranÃ§a, Ã© risco real de quebrar um widget de produÃ§Ã£o
silenciosamente â€” desproporcional ao ganho, quando existia um caminho
mais seguro disponÃ­vel.

**Feito em vez disso**: dois componentes que jÃ¡ eram arquivos
separados (nÃ£o precisaram de nenhuma extraÃ§Ã£o de lÃ³gica, sÃ³ mudanÃ§a de
como sÃ£o importados) viraram `React.lazy()` com `<Suspense>`:

- **`MapWidgetBody`**: jÃ¡ vivia em `widget-support.tsx`, movido para
  seu prÃ³prio arquivo (`map-widget-body.tsx`, cÃ³pia mecÃ¢nica, mesmo
  cÃ³digo) e importado com `lazy(() => import("./map-widget-body"))`.
  O `import "leaflet/dist/leaflet.css"` (14,8 KiB), que antes estava
  no topo de `widget-card.tsx` carregando sempre, foi junto para
  dentro do mÃ³dulo lazy â€” sÃ³ carrega quando um widget de mapa Ã©
  exibido de verdade.
- **`OperationalWidgetBody`** (presenÃ§a/validaÃ§Ã£o/carta de
  controle/planejadoÃ—realizado): jÃ¡ era um arquivo prÃ³prio
  (`operational-widget-body.tsx`, export nomeado), sÃ³ trocou de
  `import { OperationalWidgetBody } from "..."` estÃ¡tico para
  `lazy(() => import("...").then((m) => ({ default: m.OperationalWidgetBody })))`.
  Um import Ã³rfÃ£o do mesmo componente em `routes/index.tsx` (sobrado
  de uma extraÃ§Ã£o anterior, nÃ£o usado ali) foi removido â€” sem isso,
  `index.tsx` continuaria puxando o mÃ³dulo para o grafo mesmo sem
  renderizar nada.

Ambos ganharam um `<Suspense fallback={...}>` com um placeholder curto
("Carregando mapaâ€¦"/"Carregandoâ€¦") do tamanho aproximado do widget
final, evitando salto de layout perceptÃ­vel durante o carregamento.

**Resultado medido**: maior chunk genÃ©rico caiu de ~447,3 para ~357,7
KiB â€” quase 90 KiB de margem real recuperada (nÃ£o emprestada do
limite do orÃ§amento). Confirmado com `clientChunkReportPlugin`
(`ANALYZE=1`, seÃ§Ã£o 58): Leaflet virou chunk prÃ³prio de 145,3 KiB
carregado sÃ³ sob demanda (antes, ficava embutido no chunk comum
mesmo sem nenhum painel usar mapa), e um novo chunk de 47,8 KiB
carrega os widgets operacionais. `widget-support.tsx` caiu de 34,6
para 27,8 KiB dentro do chunk comum (o peso de `MapWidgetBody` que
saiu de lÃ¡).

**VerificaÃ§Ã£o ao vivo**: `MapWidgetBody` confirmado funcionando de
ponta a ponta no navegador â€” widget de mapa adicionado manualmente
(coluna "ID Venda" como local, sem correspondÃªncia geogrÃ¡fica real,
comportamento esperado), rede confirmou os mÃ³dulos
`map-widget-body.tsx`, `leaflet.css` e `leaflet.js` sendo buscados sob
demanda sÃ³ no momento da adiÃ§Ã£o do widget, controles do Leaflet
(zoom, atribuiÃ§Ã£o OpenStreetMap/CARTO) e status "Localizando 120â€¦"
renderizados corretamente, sem erro no console.
`OperationalWidgetBody` **nÃ£o pÃ´de ser confirmado por clique ao
vivo** nesta sessÃ£o: o dev server sofreu desconexÃµes/reconexÃµes de
HMR repetidas durante a tentativa (log do console mostra vÃ¡rios
ciclos "server connection lost. Polling for restart..."), deixando a
Ã¡rvore de acessibilidade e as coordenadas do DOM inconsistentes entre
leitura e clique â€” `elementFromPoint` nas coordenadas do prÃ³prio item
nÃ£o retornava o item, evidÃªncia de corrupÃ§Ã£o induzida por HMR, nÃ£o de
um bug de produto. Risco considerado baixo o suficiente para prosseguir
sem essa confirmaÃ§Ã£o: nenhuma linha de `operational-widget-body.tsx`
foi tocada, sÃ³ a forma de importaÃ§Ã£o, um padrÃ£o padrÃ£o e comum do
React (`lazy` + `.then()` para exports nomeados), jÃ¡ usado sem
problema para `MapWidgetBody` no mesmo commit.

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem â€” mudanÃ§a de carregamento, sem lÃ³gica nova), `npx tsc
--noEmit` sem erros, Prettier limpo, `npm run build` e `npm run
performance:check` aprovados com a margem recuperada descrita acima.

**PrÃ³ximo passo**: com ~92 KiB de margem real, os candidatos
restantes do mapeamento da seÃ§Ã£o 55/59 (hook de revisÃ£o em segundo
plano ~55 linhas, exportaÃ§Ã£o ~260, undo/redo ~65, aÃ§Ãµes de widget
~130) voltam a caber com folga confortÃ¡vel, sem precisar tocar o
limite do orÃ§amento.

## 64. Quinto lote da extraÃ§Ã£o do Dashboard: hook de revisÃ£o em segundo plano

Com a margem de orÃ§amento recuperada na seÃ§Ã£o 63 (~92 KiB de folga),
retomado o mapeamento da seÃ§Ã£o 55: candidato "hook de revisÃ£o em
segundo plano" (risco mÃ©dio, ~55 linhas), o prÃ³ximo depois dos
painÃ©is/sidebars/paleta de comandos jÃ¡ extraÃ­dos.

**`useBackgroundReviewAnalysis`** (`use-background-review-analysis.ts`,
novo arquivo `.ts` sem JSX, diferente dos outros hooks extraÃ­dos que
retornam elemento pronto): recebe `rows`/`columns`/`semanticOverrides`/
`previousRows` e devolve `{ backgroundReview, analysisProgress,
cancelAnalysis }`. Move os dois `useState`, o `useRef<AbortController>`
e o `useEffect` que dispara `analyzeReviewInBackground` a cada mudanÃ§a
de dados/colunas, cancelando a anÃ¡lise anterior sempre que uma nova
comeÃ§a â€” mesmo comportamento, sÃ³ reorganizado. `Dashboard` continua
consumindo `backgroundReview`/`analysisProgress` normalmente (usados
por `effectiveIntelligence`, `detailedVersionDiff` e o badge de
progresso no cabeÃ§alho) e trocou a lÃ³gica inline de cancelar
(`analysisAbort.current?.abort(); setAnalysisProgress(null);`) pela
funÃ§Ã£o `cancelAnalysis` jÃ¡ pronta.

`index.tsx` caiu de 2.523 para 2.493 linhas. TrÃªs imports ficaram
Ã³rfÃ£os e foram removidos: `analyzeReviewInBackground`,
`ReviewAnalysisProgress`/`ReviewAnalysisResult` (agora sÃ³ usados
dentro do hook) e `geocodeMissing` â€” este Ãºltimo nÃ£o tinha relaÃ§Ã£o com
esta etapa, era resÃ­duo esquecido da extraÃ§Ã£o de `MapWidgetBody` na
seÃ§Ã£o 63 (import nunca removido de `index.tsx` porque
`@typescript-eslint/no-unused-vars` estÃ¡ desligado no projeto).

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros, Prettier limpo, `npm run
build` e `npm run performance:check` aprovados (~358,2 KiB, folga
ampla confirmada). ExtraÃ§Ã£o puramente mecÃ¢nica (mesmo `useEffect`,
mesmas dependÃªncias, mesma lÃ³gica de cancelamento) â€” nÃ£o exigiu
verificaÃ§Ã£o visual ao vivo, mesmo padrÃ£o de risco baixo jÃ¡ aceito
para `useTermHint`/`usePresentationMode` nesta sÃ©rie.

Restam do mapeamento da seÃ§Ã£o 55/59: exportaÃ§Ã£o (~260 linhas),
undo/redo (~65 linhas), aÃ§Ãµes de widget (~130 linhas) â€” os trÃªs mais
entrelaÃ§ados entre si, recomendados nessa ordem.

## 65. Sexto lote da extraÃ§Ã£o do Dashboard: exportaÃ§Ã£o, e um jeito melhor de verificar ao vivo

Continuando o mapeamento da seÃ§Ã£o 55/59, o candidato de maior risco
depois do nÃºcleo de undo/redo: **exportaÃ§Ã£o** (~260 linhas, marcado
como "nÃ£o totalmente autocontido" porque `dashboardExportOptions()`
precisa do `contentRef` criado em `Dashboard` â€” o mesmo nÃ³ DOM que a
pÃ¡gina renderiza).

**`useDashboardExport`** (`use-dashboard-export.ts`): recebe
`dashboard`, `sheetName`, `data`, `sourceRowCount`, `columns`,
`widgets`, `contentRef` (passado de fora, nÃ£o criado dentro do hook) e
`onRestore` (equivalente a `p.update`), devolve `exporting`/
`exportError` e as 9 funÃ§Ãµes de exportaÃ§Ã£o
(`exportXlsx`/`exportAuditCsv`/`exportComparisonCsv`/
`exportCorrectedWorkbook`/`exportReviewPdf`/`exportEncryptedBackup`/
`restoreEncryptedBackup`/`exportPng`/`exportPdf`). O JSX do dropdown de
exportaÃ§Ã£o, o banner de erro e o `<input type="file">` escondido
continuam em `Dashboard` â€” jÃ¡ recebiam essas funÃ§Ãµes como props para
repassar ao `CommandPalette` (seÃ§Ã£o 59), entÃ£o a mudanÃ§a Ã© sÃ³ de onde
as funÃ§Ãµes vÃªm, nÃ£o de como sÃ£o consumidas.

**Ponto de atenÃ§Ã£o preservado sem alteraÃ§Ã£o**: `restoreEncryptedBackup`
continua chamando `p.update(copy)` diretamente (via `onRestore`),
**sem** passar pelo histÃ³rico de undo/redo â€” comportamento prÃ©-
existente documentado como intencional, nÃ£o uma inconsistÃªncia a
corrigir aqui.

`index.tsx` caiu de 2.493 para 2.317 linhas. Nove imports ficaram
Ã³rfÃ£os e foram removidos: `decryptDashboardBackup`/
`encryptDashboardBackup`/`safeRowsForSpreadsheet`
(`encrypted-backup.ts`), `auditExportRows`/`comparisonExportRows`/
`reviewReportSections`/`rowsToCsv` (`review-export.ts`),
`exportDashboardPdf`/`exportDashboardPng` (`dashboard-export.ts`).

**VerificaÃ§Ã£o ao vivo â€” descoberta importante desta etapa**: a preview
individual de cada PR no Vercel exigia login SSO da equipe, entÃ£o sÃ³
dava pra testar a `main` jÃ¡ mesclada, nÃ£o o PR em si. Por pedido do
usuÃ¡rio, a proteÃ§Ã£o de deployment de preview foi desativada nas
configuraÃ§Ãµes do projeto Vercel (`Settings â†’ Deployment Protection`).
A partir de agora, cada PR ganha uma URL de preview pÃºblica
(`oliqualidade-git-<branch>-<hash>-meuludi.vercel.app`, encontrÃ¡vel
via `gh pr view <n> --json comments` procurando o comentÃ¡rio do bot da
Vercel, ou direto na aba "Checks" do PR) â€” **muito mais estÃ¡vel que o
dev server local** (sem os ciclos de reconexÃ£o de HMR que corrompiam a
Ã¡rvore do DOM entre leitura e clique, registrados na seÃ§Ã£o 63). Path
recomendado daqui pra frente: abrir a preview do PR com
`preview_start({ url })`, sem precisar do dev server local pra
verificaÃ§Ã£o visual/interativa.

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros de primeira, Prettier limpo de
primeira, `npm run build` e `npm run performance:check` aprovados
(~362,8 KiB, margem confortÃ¡vel). **Verificado ao vivo na preview do
Vercel do PR** (achada via `gh pr view <n> --json comments` procurando
o link `vercel.app` no comentÃ¡rio do bot): "Planilha XLSX" carregou o
chunk `xlsx.js` sob demanda (confirmado em `read_network_requests`) e
disparou o download; "Auditoria CSV" mostrou o toast correto ("Ainda
nÃ£o hÃ¡ ajustes registrados para exportar."); sem erros de console alÃ©m
de um bloqueio de CSP do prÃ³prio widget de feedback do Vercel, nÃ£o
relacionado ao app. Backup criptografado e restauraÃ§Ã£o nÃ£o foram
testados por automaÃ§Ã£o â€” dependem de `window.prompt`, que bloqueia o
navegador automatizado; risco considerado baixo por nÃ£o ter nenhuma
lÃ³gica interna alterada.

Restam undo/redo (~65 linhas, o "cÃ©rebro" chamado por ~9 pontos
diferentes) e aÃ§Ãµes de widget (~130 linhas, `traceException` cruza
busca/filtro/foco/histÃ³rico) â€” os dois Ãºltimos e mais entrelaÃ§ados.

## 66. SÃ©timo lote da extraÃ§Ã£o do Dashboard: nÃºcleo de undo/redo

PenÃºltimo candidato do mapeamento da seÃ§Ã£o 55/59, marcado como risco
alto: o "cÃ©rebro" de undo/redo que ~9 mutadores diferentes em
`Dashboard` chamam via `recordHistory()` antes de alterar linhas,
filtros, colunas, widgets ou decisÃµes de exceÃ§Ã£o.

**`useUndoRedoHistory`** (`use-undo-redo-history.ts`): recebe `sheet`,
`dashboardId` (`d.id`), `activeSheetIndex` e `updateSheet`, devolve
`{ canUndo, canRedo, undo, redo, recordHistory }`. Move o tipo
`HistorySnapshot`, `historyRef`/`forceHistoryUpdate`,
`dashboardSnapshot()`, `recordHistory`, `undo` e `redo` â€” mesma lÃ³gica,
mesma pilha (`recordUndo`/`stepUndo`/`stepRedo` de `data-review.ts`),
mesmo reset ao trocar de painel/aba. O `useEffect` que sincroniza
`undoRef.current`/`redoRef.current` (usados pelo atalho de teclado
âŒ˜Z/â‡§âŒ˜Z definido antes deste bloco) **continua em `Dashboard`** â€”
sÃ³ passou a apontar para o `undo`/`redo` que agora vÃªm do hook, em vez
de funÃ§Ãµes locais.

Os ~9 pontos que chamam `recordHistory()` (`setFilters`, `setColumns`,
`setSemanticOverride`, `resetSemanticOverride`,
`setExceptionDecision`, `correctException`, `editTableCell`,
`setWidgets` e afins) **nÃ£o foram tocados** â€” continuam em `Dashboard`,
sÃ³ chamando a funÃ§Ã£o que agora vem do hook em vez de uma closure local.
Isso Ã© intencional: mover sÃ³ o nÃºcleo, sem reescrever os call-sites,
reduz o nÃºmero de coisas que podem quebrar de uma vez.

`index.tsx` caiu de 2.317 para 2.251 linhas. Oito imports ficaram
Ã³rfÃ£os e foram removidos: `recordUndo`/`stepRedo`/`stepUndo`/
`AuditEntry`/`UndoHistory` (`data-review.ts`) e `ExceptionDecisions`/
`SemanticOverrides`/`SpreadsheetIntelligence`
(`spreadsheet-intelligence.ts`) â€” `analyzeSpreadsheet`,
`ExceptionDecision` (singular), `SemanticRole` e
`SpreadsheetException` continuam em uso em `Dashboard` fora do bloco
de histÃ³rico, entÃ£o ficaram.

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros (um ajuste: `ExceptionDecisions`
vinha de `spreadsheet-intelligence.ts`, nÃ£o de `types.ts` como
presumido na primeira versÃ£o do hook â€” corrigido antes do commit),
Prettier limpo, `npm run build` e `npm run performance:check`
aprovados (~363,7 KiB). **Verificado ao vivo na preview do Vercel, o
ciclo completo**: mudanÃ§a do papel semÃ¢ntico da coluna "Vendas" (painel
de Colunas, `setSemanticOverride` â†’ `recordHistory`) de "Resultado"
para "Total" â†’ "Desfazer" confirmado voltando pra "Resultado" â†’
"Refazer" confirmado voltando pra "Total" â€” undo/redo funcionando de
ponta a ponta pelo hook extraÃ­do, sem erro de console.

Resta sÃ³ o candidato final: aÃ§Ãµes de widget (~130 linhas,
`traceException` cruza busca/filtro/foco/histÃ³rico ao mesmo tempo â€”
o mais entrelaÃ§ado de todos, deixado por Ãºltimo de propÃ³sito).

## 67. Oitavo e Ãºltimo lote da extraÃ§Ã£o do Dashboard: aÃ§Ãµes de widget

Fecha o mapeamento completo da seÃ§Ã£o 55/59 â€” o candidato deixado por
Ãºltimo de propÃ³sito, o mais entrelaÃ§ado com o resto do estado da UI:
`traceException` mexe em `search`/`sort`/`filters`/`focusedCell`/
`widgets`/histÃ³rico ao mesmo tempo, para levar o usuÃ¡rio atÃ© a linha
de origem de uma exceÃ§Ã£o.

**`useWidgetActions`** (`use-widget-actions.ts`): recebe `sheet`,
`updateSheet`, `recordHistory` (do `useUndoRedoHistory`, seÃ§Ã£o 66),
`widgetClipboard`/`setWidgetClipboard`, e os setters de UI que
`traceException` precisa cruzar (`setSearch`, `setSort`, `setFilters`,
`setFocusedCell`) â€” recebidos como parÃ¢metros em vez de reimplementados,
mesma decisÃ£o jÃ¡ tomada para `useDashboardExport` (seÃ§Ã£o 65) com
`contentRef`. Devolve `widgets` (a lista efetiva, com fallback pro
plano automÃ¡tico) e as 8 funÃ§Ãµes de mutaÃ§Ã£o
(`setWidgets`/`addWidget`/`copyCurrentWidget`/`pasteCopiedWidget`/
`updateWidget`/`traceException`/`removeWidget`/`moveWidget`/
`reorderWidget`).

**`canAdd` ficou em `Dashboard`**, deliberadamente fora do hook: Ã© sÃ³
um mapa estÃ¡tico que lÃª `nums`/`groupableCols`/`dateCol` (variÃ¡veis do
pipeline de dados central, usadas em vÃ¡rios outros lugares de
`Dashboard`) â€” mover isso pro hook inflaria a superfÃ­cie de parÃ¢metros
sem reduzir risco real, jÃ¡ que nÃ£o Ã© uma mutaÃ§Ã£o, sÃ³ uma checagem de
"esse tipo de widget faz sentido com os dados atuais".

`index.tsx` caiu de 2.251 para 2.195 linhas. Dois imports ficaram
Ã³rfÃ£os e foram removidos: `duplicateWidget` (`widgets.ts`) e
`decodeCellAddress` (`cell-address.ts`) â€” ambos agora sÃ³ usados dentro
do hook.

**Isso fecha o plano de extraÃ§Ã£o do Dashboard mapeado nas seÃ§Ãµes 51 e
55**: dos oito candidatos identificados (diÃ¡logo de junÃ§Ã£o,
apresentaÃ§Ã£o, coluna calculada, marcadores, painÃ©is/sidebars/paleta de
comandos, revisÃ£o em segundo plano, exportaÃ§Ã£o, undo/redo, aÃ§Ãµes de
widget), todos foram extraÃ­dos ao longo de 8 lotes nesta sessÃ£o e na
anterior. O nÃºcleo que resta em `Dashboard` Ã© genuinamente o nÃºcleo:
a cadeia de `useMemo` do pipeline de dados e a orquestraÃ§Ã£o da grade
de widgets (renderizaÃ§Ã£o de cada `WidgetCard`, cÃ¡lculo de `data`
filtrado, `canAdd`, `assistantContext` etc.) â€” que nÃ£o formam um
conjunto de responsabilidades separÃ¡vel sem uma reestruturaÃ§Ã£o maior
(ex.: um reducer central), decisÃ£o jÃ¡ registrada como fora do escopo
desta sÃ©rie de extraÃ§Ãµes.

Verificado com `npx vitest run` (480 passou, 11 pulados, mesma
contagem), `npx tsc --noEmit` sem erros de primeira, Prettier (duas
quebras de linha ajustadas para bater com o formatador), `npm run
build` e `npm run performance:check` aprovados (~365,2 KiB).
**Verificado ao vivo na preview do Vercel**: `addWidget` (menu
"Widget" â†’ "Indicador de avaliaÃ§Ã£o", 5â†’6 widgets), `copyCurrentWidget`
(toast "Widget copiado"), `pasteCopiedWidget` (novo widget "Vendas"
duplicado), `removeWidget` (de volta a 5) e `moveWidget` (ordem trocou
corretamente) â€” todos confirmados funcionando, sem erro de console
relacionado ao app.

**Fim da sÃ©rie de extraÃ§Ã£o do Dashboard iniciada nesta sessÃ£o** (seÃ§Ãµes
55, 56, 57, 58, 59, 63, 64, 65, 66 e 67): oito lotes de PRs, todos
mesclados, `index.tsx` caindo de 3.328 (inÃ­cio desta sessÃ£o) para 2.195
linhas â€” e de 10.282 desde o inÃ­cio do plano geral na seÃ§Ã£o 36. PrÃ³ximo
corte estrutural, se houver, precisa investigar o nÃºcleo restante de
`Dashboard` (pipeline de dados + grade de widgets) do zero, nÃ£o
mapeado nesta sÃ©rie.

## 68. InventÃ¡rio de hyperlinks exposto na revisÃ£o (item de menor esforÃ§o da reauditoria da seÃ§Ã£o 50)

A seÃ§Ã£o 50 jÃ¡ tinha identificado que `parseHyperlinks`/`inspectWorkbookFeatures`
(`workbook-metadata.ts`) extraem hyperlinks por endereÃ§o/aba desde a fase 3 do
nÃºcleo Rust (`target`, `tooltip` opcional), e que `attachWorkbookFeatures` jÃ¡
anexava esse array em `worksheet["!oliAdvanced"].hyperlinks` â€” mas o Ãºnico
consumidor era cÃ©lula a cÃ©lula, para popular `cell.l` (compatibilidade
SheetJS). Nenhum cÃ³digo lia o array agregado; o dado existia e nunca virava
inventÃ¡rio consultÃ¡vel, ao contrÃ¡rio de `structuredTables`/`pivotTables`
(jÃ¡ expostos na revisÃ£o desde a extraÃ§Ã£o inicial).

Seguido o mesmo padrÃ£o jÃ¡ usado por essas duas: `ImportDiagnostics`
(`import-intelligence.ts`) ganhou o campo `hyperlinks: WorkbookCellHyperlink[]`,
populado em `sheetMeta()` a partir de `advanced?.hyperlinks ?? []` (o mesmo
objeto que `!oliAdvanced` jÃ¡ carregava, sem parsing novo) e propagado ao
retorno via o spread `...meta` que jÃ¡ existia. Um aviso
`"N hyperlink(s) do Excel preservado(s)"` foi adicionado a `warnings`,
espelhando o aviso jÃ¡ existente de Pivot Tables.

Na revisÃ£o (`review.tsx`), um painel `<details>` "Hyperlinks preservados"
lista endereÃ§o â†’ destino â†’ tooltip por aba, limitado Ã s primeiras 20 entradas
(mesmo limite jÃ¡ usado no painel de observaÃ§Ãµes/comentÃ¡rios,
`sourceNotes`), sÃ³ aparecendo quando a aba ativa tem pelo menos um hyperlink.

Teste de regressÃ£o em `import-intelligence.test.ts` monta um `!oliAdvanced`
sintÃ©tico com um hyperlink e confirma que `diagnoseImportedSheet` propaga o
array e o aviso â€” nÃ£o depende de nenhuma fixture real, jÃ¡ que o parsing em si
(`parseHyperlinks`) jÃ¡ tinha cobertura prÃ³pria em `workbook-metadata.test.ts`.

Verificado com `npx vitest run` (481 passou, 11 pulados â€” um teste novo),
`npx tsc --noEmit` sem erros (um mock de `ImportDiagnostics` em
`auto-dashboard.test.ts` precisou do campo `hyperlinks: []` novo), Prettier
limpo (checado via normalizaÃ§Ã£o CRLFâ†’LF, ver seÃ§Ã£o de armadilhas), `npm run
build` e `npm run performance:check` aprovados (maior chunk genÃ©rico subiu de
365,2 para 366,5 KiB â€” dentro da margem de ~450 KiB).

## 69. InventÃ¡rio de nomes definidos e links externos (prÃ³ximo item por esforÃ§o da lista pendente)

Seguindo a mesma trilha da seÃ§Ã£o 68 (hyperlinks), o prÃ³ximo item era
"nomes definidos e links externos", com um atalho real: o **SheetJS jÃ¡
analisa nomes definidos nativamente** em `wb.Workbook.Names` ao ler
qualquer XLSX â€” nÃ£o seria necessÃ¡rio nenhum parsing novo para eles. Mas
essa API nÃ£o Ã© usada por `attachWorkbookFeatures` (que opera diretamente
sobre os bytes do ZIP via `inspectWorkbookFeatures`, sem acesso ao `wb` jÃ¡
lido), e mais importante: `wb.Workbook.Names` nÃ£o filtra por aba â€” cada
nome tem um Ã­ndice `Sheet` opcional (`localSheetId` do XML) que precisa
ser resolvido contra a ordem real das abas para decidir se o nome Ã©
global (Name Manager mostra em todo lugar) ou local a uma aba especÃ­fica
(sÃ³ aparece nessa aba). Optei por fazer o parsing prÃ³prio de
`<definedName>` em `xl/workbook.xml` (`parseDefinedNames`), reaproveitando
o `decodeXml`/`attr` jÃ¡ existentes, para manter a filtragem por aba
consistente com o resto do arquivo (que jÃ¡ lÃª o XML bruto de qualquer
forma) em vez de misturar duas fontes de verdade (SheetJS + XML bruto)
para o mesmo dado.

**ReferÃªncias a arquivos externos** (`xl/externalLinks`) nÃ£o tÃªm
equivalente nativo no SheetJS â€” parsing genuinamente novo, mas seguindo
o padrÃ£o jÃ¡ estabelecido em `relationships()`/hyperlinks: o
`<externalReference r:id="...">` em `workbook.xml` resolve via
`workbookRels` para a parte `xl/externalLinks/externalLinkN.xml`; o
destino real (URL ou caminho de arquivo) nÃ£o estÃ¡ nessa parte, mas no seu
prÃ³prio `.rels` (`xl/externalLinks/_rels/externalLinkN.xml.rels`),
mesma indireÃ§Ã£o de dois nÃ­veis jÃ¡ usada para hyperlinks externos.

**DecisÃ£o de escopo**: `AdvancedSheetMetadata` jÃ¡ Ã© uma estrutura por aba
(`Map<sheetName, ...>`), mas nomes definidos e links externos sÃ£o dados
de workbook inteiro. Threadar um novo objeto "nÃ­vel workbook" atÃ©
`review.tsx` exigiria mexer no worker de leitura
(`workbook-reader.worker`), no cliente
(`workbook-reader-client.ts`) e no estado de `routes/index.tsx` â€” risco e
esforÃ§o bem maiores que o "esforÃ§o mÃ©dio" estimado. Em vez disso,
mantive os dois dentro de `AdvancedSheetMetadata` (jÃ¡ propagada por todo
o pipeline existente via `!oliAdvanced` â†’ `sheetMeta()` â†’ spread em
`ImportDiagnostics`), calculando-os **uma vez** por workbook em
`inspectWorkbookFeatures` e depois filtrando por aba: `externalLinks` Ã©
idÃªntico em todas as abas (nÃ£o tÃªm dono natural); `definedNames` Ã©
filtrado para `scope === null` (global) ou `scope === nomeDaAba`,
espelhando como o Name Manager do Excel jÃ¡ filtra por aba â€” nomes locais
de uma aba nÃ£o aparecem nas outras. Nomes internos do Excel
(`_xlnm.` â€” Ã¡rea de impressÃ£o, banco de filtro etc.) sÃ£o descartados por
nÃ£o serem definiÃ§Ãµes do usuÃ¡rio.

Dois painÃ©is `<details>` novos em `review.tsx` ("Nomes definidos" e
"ReferÃªncias a arquivos externos"), mesmo padrÃ£o visual de
"Hyperlinks preservados" (seÃ§Ã£o 68).

Cobertura de teste em duas camadas, como jÃ¡ Ã© convenÃ§Ã£o no arquivo:
`workbook-metadata.test.ts` ganhou um workbook sintÃ©tico de duas abas com
um nome global, um nome local a uma aba e um nome interno do Excel
(`_xlnm._FilterDatabase`, que deve ser ignorado), mais uma referÃªncia
externa â€” confirma o parsing e a filtragem por escopo diretamente.
`import-intelligence.test.ts` ganhou um teste espelhando o jÃ¡ existente
para hyperlinks, confirmando que `diagnoseImportedSheet` propaga os dois
campos e os avisos correspondentes a partir de um `!oliAdvanced`
sintÃ©tico.

Verificado com `npx vitest run` (483 passou, 11 pulados â€” dois testes
novos), `npx tsc --noEmit` sem erros (mocks de `ImportDiagnostics` em
`auto-dashboard.test.ts` e `import-intelligence.test.ts` precisaram dos
campos `definedNames: []`/`externalLinks: []` novos), Prettier limpo apÃ³s
duas quebras de linha ajustadas manualmente para bater com o formatador
em `workbook-metadata.ts` (checado via normalizaÃ§Ã£o CRLFâ†’LF), `npm run
build` e `npm run performance:check` aprovados (maior chunk genÃ©rico subiu
de 366,5 para 369,8 KiB â€” ainda dentro da margem de ~450 KiB).

## 70. ValidaÃ§Ãµes de dados do Excel (Data Validation), terceiro item da lista pendente

Diferente de nomes definidos/links externos (seÃ§Ã£o 69), validaÃ§Ã£o de
dados Ã© genuinamente por aba â€” cada `<dataValidation>` mora dentro do
prÃ³prio `xl/worksheets/sheetN.xml`, entÃ£o nÃ£o houve o mesmo problema de
threading atÃ© `routes/index.tsx`: `dataValidations` entrou direto em
`AdvancedSheetMetadata` como mais um array por aba, seguindo exatamente o
mesmo mecanismo de `hyperlinks` (mesmo arquivo, sem indireÃ§Ã£o de
relacionamento â€” o `sqref`/`type`/`formula1`/`formula2` jÃ¡ estÃ£o
inline no elemento).

`parseDataValidations` (`workbook-metadata.ts`) lÃª `sqref` (intervalo),
`type` (`list`, `whole`, `decimal`, `date`, `time`, `textLength`,
`custom`), `allowBlank`, e opcionalmente `formula1`/`formula2` (a
restriÃ§Ã£o em si â€” para `list` normalmente uma string literal entre aspas
como `"Baixo,MÃ©dio,Alto"`, ou uma referÃªncia de intervalo/nome definido)
e os textos de prompt/erro configurÃ¡veis pelo autor da planilha
(`promptTitle`, `prompt`, `errorTitle`, `error`). Nenhuma tentativa de
interpretar o conteÃºdo de `formula1`/`formula2` alÃ©m de decodificar
entidades XML â€” mostrado como texto bruto, mesmo espÃ­rito de
"preservar, nÃ£o recalcular" jÃ¡ aplicado a Pivot Tables.

Painel `<details>` "ValidaÃ§Ãµes de dados do Excel" em `review.tsx`, mesmo
padrÃ£o visual dos demais, mostrando intervalo, tipo, `formula1` e
`prompt` quando presentes (tÃ­tulo/mensagem de erro ficam de fora do
resumo por brevidade â€” o dado completo jÃ¡ estÃ¡ na estrutura tipada, caso
vire necessÃ¡rio expandir a UI depois).

Cobertura em duas camadas: `workbook-metadata.test.ts` ganhou um
`<dataValidation type="list">` completo (com `formula1`, `promptTitle` e
`prompt` acentuados, para confirmar tambÃ©m `decodeXml`/UTF-8) na aba
`Vendas` jÃ¡ existente na fixture compartilhada; `import-intelligence.test.ts`
ganhou um teste espelhando os jÃ¡ existentes para hyperlinks/nomes
definidos, confirmando a propagaÃ§Ã£o via `!oliAdvanced` sintÃ©tico e o
aviso correspondente.

Verificado com `npx vitest run` (484 passou, 11 pulados â€” um teste
novo), `npx tsc --noEmit` sem erros (mock de `ImportDiagnostics` em
`auto-dashboard.test.ts` precisou do campo `dataValidations: []` novo),
Prettier limpo (checado via normalizaÃ§Ã£o CRLFâ†’LF), `npm run build` e
`npm run performance:check` aprovados (maior chunk genÃ©rico subiu de
369,8 para 371,9 KiB â€” ainda dentro da margem de ~450 KiB).

## 71. DetecÃ§Ã£o de macros VBA, e correÃ§Ã£o de uma lista desatualizada pelas prÃ³prias seÃ§Ãµes 68-70

Ãšltimo item de esforÃ§o maior pedido pelo usuÃ¡rio: detecÃ§Ã£o (nÃ£o
execuÃ§Ã£o) de macros VBA. Mais simples que os anteriores â€” um workbook
com macros carrega o binÃ¡rio compilado da VBA em `xl/vbaProject.bin`
dentro do pacote OOXML; a presenÃ§a desse arquivo jÃ¡ Ã© 100% do que
precisa ser verificado, sem nenhum parsing de XML. `hasVbaMacros`
(`workbook-metadata.ts`) Ã© sÃ³ `Boolean(zip["xl/vbaProject.bin"])`,
calculado uma vez em `inspectWorkbookFeatures` (mesmo padrÃ£o de
"calculado uma vez, replicado em toda aba" jÃ¡ usado para
`externalLinks` na seÃ§Ã£o 69, jÃ¡ que a presenÃ§a de macros tambÃ©m Ã© uma
propriedade do workbook inteiro, nÃ£o de uma aba especÃ­fica).

Como Ã© um flag booleano Ãºnico (nÃ£o uma coleÃ§Ã£o), nÃ£o ganhou painel
`<details>` prÃ³prio â€” sÃ³ um aviso em `warnings` (mesmo tratamento jÃ¡
dado a `hasAutoFilter`/`hasTables`), que jÃ¡ aparece na seÃ§Ã£o
"DiagnÃ³stico da planilha" existente sem precisar de UI nova: "a
planilha contÃ©m macros VBA; elas sÃ£o preservadas no arquivo original,
mas nÃ£o sÃ£o executadas nem decompiladas".

**Efeito colateral encontrado e corrigido**: `UNSUPPORTED_FIDELITY_FEATURES`
(`fidelity-meter.ts`), a lista que documenta o que a mÃ©trica de fidelidade
de reconciliaÃ§Ã£o cÃ©lula-a-cÃ©lula deliberadamente nÃ£o mede, tinha ficado
desatualizada pelas prÃ³prias seÃ§Ãµes 68-70 desta sessÃ£o. A linha "Nomes
definidos, links externos e hyperlinks como inventÃ¡rio rastreÃ¡vel"
afirmava que esses trÃªs nÃ£o eram sequer um inventÃ¡rio rastreÃ¡vel â€” o que
deixou de ser verdade a partir da seÃ§Ã£o 68. Removida por completo,
alinhando com o precedente jÃ¡ existente de `structuredTables`/
`pivotTables` (tambÃ©m inventariados sem reconciliaÃ§Ã£o cÃ©lula-a-cÃ©lula e
nunca estiveram nessa lista). A linha "ValidaÃ§Ãµes de dados,
agrupamentos/outlines e segmentaÃ§Ãµes" foi reduzida para "Agrupamentos/
outlines e segmentaÃ§Ãµes", pelo mesmo motivo (data validation jÃ¡ virou
inventÃ¡rio na seÃ§Ã£o 70). "Macros VBA" permanece na lista â€” detectar a
presenÃ§a do binÃ¡rio nÃ£o Ã© o mesmo que reconciliar/executar o conteÃºdo,
mesma lÃ³gica jÃ¡ aplicada a "RecÃ¡lculo integral de fÃ³rmulas do Excel"
(fÃ³rmulas jÃ¡ sÃ£o diagnosticadas e listadas, mas recÃ¡lculo completo
continua fora de escopo) â€” sÃ³ ganhou uma qualificaÃ§Ã£o entre parÃªnteses
("detectadas, mas nunca executadas nem decompiladas") para deixar clara
a diferenÃ§a entre "detectado" e "reconciliado". O teste que fixava a
string exata `"Macros VBA"` em `workbook-fidelity.test.ts` foi ajustado
para checar por prefixo, jÃ¡ que o texto mudou.

Cobertura em duas camadas: `workbook-metadata.test.ts` ganhou
`xl/vbaProject.bin` na fixture compartilhada (com asserÃ§Ã£o
`hasVbaMacros: true`) e um teste dedicado confirmando `false` quando o
arquivo estÃ¡ ausente; `import-intelligence.test.ts` ganhou um teste
espelhando os jÃ¡ existentes, confirmando a propagaÃ§Ã£o via `!oliAdvanced`
sintÃ©tico e o aviso correspondente.

Verificado com `npx vitest run` (486 passou, 11 pulados â€” dois testes
novos), `npx tsc --noEmit` sem erros (mock de `ImportDiagnostics` em
`auto-dashboard.test.ts` precisou do campo `hasVbaMacros: false` novo,
e uma duplicata acidental de `dataValidations: []` introduzida ao editar
foi corrigida antes do commit), Prettier limpo (duas quebras de linha
ajustadas manualmente para bater com o formatador, checado via
normalizaÃ§Ã£o CRLFâ†’LF), `npm run build` e `npm run performance:check`
aprovados (maior chunk genÃ©rico subiu de 371,9 para 372,2 KiB â€” ainda
dentro da margem de ~450 KiB).

## 72. InventÃ¡rio de imagens embutidas (fecha a lista de itens de esforÃ§o maior pedidos pelo usuÃ¡rio nesta sessÃ£o)

Ãšltimo item da rodada "imagens/desenhos, macros VBA" oferecida ao
usuÃ¡rio (seÃ§Ãµes 68-71 jÃ¡ cobriram macros e os itens de esforÃ§o mÃ©dio).
Diferente de todos os anteriores, imagens sÃ£o a primeira feature desta
sessÃ£o que exige indireÃ§Ã£o em **dois** nÃ­veis de relacionamento
encadeados, e o primeiro parsing que precisa lidar com um prefixo de
namespace real (`xdr:`) â€” os elementos de desenho do Excel (drawingML
spreadsheet drawing) vivem num arquivo Ã  parte
(`xl/drawings/drawingN.xml`) cuja raiz sempre usa o prefixo `xdr:`
porque o arquivo combina dois namespaces (`xdr:` para posicionamento na
grade, `a:` para o desenho vetorial genÃ©rico do Office). Todo o resto do
parsing no arquivo (`hyperlinks`, `tableParts`, `pivotTableDefinition`
etc.) nunca precisou de prefixo porque vive dentro do prÃ³prio XML da
aba, que usa namespace default sem prefixo.

Cadeia de indireÃ§Ã£o: `<drawing r:id="X"/>` no XML da prÃ³pria aba resolve
via `sheetRels` (jÃ¡ existente, mesmo mapa usado por tabelas/pivÃ´s/
hyperlinks) para `xl/drawings/drawingN.xml`; dentro desse arquivo, cada
`<xdr:twoCellAnchor>`/`<xdr:oneCellAnchor>` com um `<xdr:pic>` filho tem
um `<a:blip r:embed="Y">` cujo `Y` sÃ³ resolve para o arquivo de mÃ­dia
real (`xl/media/imageN.png`) atravÃ©s do `.rels` **do prÃ³prio arquivo de
desenho** (`xl/drawings/_rels/drawingN.xml.rels`) â€” uma terceira parte,
independente do `.rels` da aba. `parseImages` (`workbook-metadata.ts`)
resolve as duas indireÃ§Ãµes reaproveitando `relationships()` (jÃ¡ genÃ©rica
o bastante para qualquer par XML+base), sem nenhuma dependÃªncia nova.

Escopo deliberadamente contido: sÃ³ imagens embutidas (`xdr:pic`), como
o nome da pendÃªncia original jÃ¡ sinalizava ("imagens/desenhos" tratado
como duas features possÃ­veis, escolhendo a de maior valor/menor
ambiguidade). Formas (`xdr:sp`), caixas de texto e grÃ¡ficos nativos
embutidos (`xdr:graphicFrame`) usam elementos irmÃ£os dentro do mesmo
anchor e ficam de fora â€” nÃ£o tÃªm precedente de parsing e nÃ£o foram
pedidos explicitamente; se algum dia forem necessÃ¡rios, Ã© investigaÃ§Ã£o
nova a partir do mesmo `drawingN.xml` jÃ¡ sendo lido aqui. A posiÃ§Ã£o de
ancoragem (`anchor`) Ã© aproximada: sÃ³ o canto superior esquerdo
(`<xdr:from>`), convertido de col/row 0-based para endereÃ§o A1 via
`XLSX.utils.encode_cell` (mesma funÃ§Ã£o jÃ¡ usada em `cellAddresses`); o
formato Ã© inferido pela extensÃ£o do arquivo de mÃ­dia (`PNG`, `JPEG`
etc.), sem inspecionar os bytes.

Como Ã© uma coleÃ§Ã£o por aba (uma aba pode ter vÃ¡rias imagens, cada
`<drawing>` do Excel Ã© por aba, nunca compartilhado entre abas â€” ao
contrÃ¡rio de nomes definidos/links externos/macros), `images` entrou
direto em `AdvancedSheetMetadata`, sem o problema de threading das
seÃ§Ãµes 69/71. Painel `<details>` "Imagens embutidas" em `review.tsx`,
mesmo padrÃ£o dos demais, mostrando Ã¢ncora, formato e nome.

Cobertura em duas camadas: `workbook-metadata.test.ts` ganhou uma
`<drawing>` completa (worksheet â†’ drawing â†’ media, trÃªs relacionamentos
encadeados) na fixture compartilhada, com um PNG de 4 bytes fictÃ­cio
como mÃ­dia â€” suficiente pra testar a cadeia de resoluÃ§Ã£o sem precisar de
uma imagem real; `import-intelligence.test.ts` ganhou um teste
espelhando os jÃ¡ existentes, confirmando a propagaÃ§Ã£o via `!oliAdvanced`
sintÃ©tico e o aviso correspondente.

Verificado com `npx vitest run` (487 passou, 11 pulados â€” um teste
novo), `npx tsc --noEmit` sem erros (mock de `ImportDiagnostics` em
`auto-dashboard.test.ts` e quatro blocos de `!oliAdvanced` sintÃ©tico em
`import-intelligence.test.ts` precisaram do campo `images: []` novo),
Prettier limpo de primeira (checado via normalizaÃ§Ã£o CRLFâ†’LF), `npm run
build` e `npm run performance:check` aprovados (maior chunk genÃ©rico
subiu de 372,2 para 374,4 KiB â€” ainda dentro da margem de ~450 KiB).

**Isso fecha a rodada de itens de esforÃ§o maior da reauditoria de
fidelidade** (seÃ§Ã£o 50): hyperlinks (68), nomes definidos/links
externos (69), validaÃ§Ãµes de dados (70), macros VBA (71) e imagens
embutidas (72), todos expostos como inventÃ¡rio rastreÃ¡vel na revisÃ£o,
cada um com PR prÃ³prio mesclado e verificado ao vivo na preview do
Vercel. Formas/grÃ¡ficos nativos, agrupamentos/outlines e segmentaÃ§Ãµes
continuam fora â€” nenhum foi pedido explicitamente, e cada um exigiria
investigaÃ§Ã£o de formato prÃ³pria, sem reaproveitar diretamente o que jÃ¡
foi construÃ­do aqui.
## 73. Primeiro teste E2E real (Playwright), e um bug real de corrida de hidrataÃ§Ã£o SSR encontrado no processo

UsuÃ¡rio confirmou explicitamente (via pergunta direta) que queria
configurar Playwright â€” item que a seÃ§Ã£o 65 jÃ¡ tinha identificado como
"pode se tornar mais viÃ¡vel [com a descoberta da preview do Vercel], mas
ainda nÃ£o foi tentado, e Ã© uma decisÃ£o de ferramenta/CI que talvez
mereÃ§a confirmaÃ§Ã£o do usuÃ¡rio antes de comeÃ§ar".

**InstalaÃ§Ã£o**: `@playwright/test` como devDependency;
`npx playwright install --with-deps chromium` baixou o Chrome for
Testing (~192 MiB) sem problema de rede neste ambiente. Sem impacto no
bundle de produÃ§Ã£o (dependÃªncia de desenvolvimento sÃ³ usada pelo runner
de teste).

**Descoberta real durante a primeira tentativa**: o mecanismo nativo
`webServer` do Playwright (que sobe o `npm run dev` e faz polling HTTP
atÃ© responder) trava indefinidamente contra este dev server â€” nÃ£o por
lentidÃ£o comum, mas porque a primeira requisiÃ§Ã£o feita bem no instante
em que a porta abre colide com uma janela real onde o ambiente `nitro`
do Vite ainda nÃ£o terminou de inicializar (`NitroViteError: Vite
environment "nitro" is unavailable`, status 503) e a conexÃ£o HTTP fica
pendurada por dezenas de segundos antes de sequer retornar erro â€” tempo
suficiente para estourar os 180s de timeout configurado, mesmo o
servidor ficando genuinamente pronto e respondendo bem logo depois
(confirmado manualmente: uma Ãºnica requisiÃ§Ã£o `curl` disparada 20s apÃ³s
o start funciona sem problema). Isso Ã© o mesmo fenÃ´meno documentado nas
armadilhas de ambiente jÃ¡ conhecidas ("espere ~10-15s depois de
`preview_start` antes do primeiro `navigate`"), sÃ³ que atingindo o probe
automÃ¡tico do Playwright em vez de uma navegaÃ§Ã£o manual.

**SoluÃ§Ã£o**: em vez de reinventar a detecÃ§Ã£o de prontidÃ£o, o
`playwright.config.ts` ganhou suporte a uma variÃ¡vel `OLI_E2E_BASE_URL`
que, quando definida, desativa o `webServer` nativo do Playwright e usa
a URL jÃ¡ fornecida como pronta â€” permitindo reaproveitar
**exatamente** o mesmo mecanismo jÃ¡ comprovado e documentado no job
`security-smoke` do CI (`application.yml`): sobe o dev server em
background, espera com um laÃ§o de `curl --max-time 60` atÃ© 10
tentativas, sÃ³ entÃ£o roda os testes. Sem essa variÃ¡vel (uso local sem
CI), o `webServer` nativo continua disponÃ­vel para conveniÃªncia, com um
timeout generoso (180s) â€” funciona bem quando nÃ£o hÃ¡ corrida com a
inicializaÃ§Ã£o a frio do bundler.

**Bug real de produto encontrado e nÃ£o corrigido nesta PR**: com o
`webServer` contornado, o primeiro teste (clicar em "Ver demonstraÃ§Ã£o"
â†’ confirmar a revisÃ£o â†’ chegar ao painel) ainda falhava de forma
consistente (3/3 execuÃ§Ãµes) atÃ© adicionar
`page.waitForLoadState("networkidle")` logo apÃ³s `page.goto("/")`. Sem
essa espera, o primeiro clique no botÃ£o "Ver demonstraÃ§Ã£o"
(`components/oliam/empty.tsx`) nÃ£o tem nenhum efeito â€” nem erro no
console, nem mudanÃ§a de tela â€” e sÃ³ o **segundo** clique funciona.
Confirmado com um script de depuraÃ§Ã£o isolado (clique duplo + captura de
console/erros de pÃ¡gina): Ã© uma corrida real de hidrataÃ§Ã£o SSR do
TanStack Start, nÃ£o flakiness do Playwright â€” o HTML jÃ¡ estÃ¡ visÃ­vel na
tela quando o clique acontece, mas o `onClick` do React ainda nÃ£o foi
conectado. **Sinalizado como tarefa separada** (fora do escopo desta
configuraÃ§Ã£o de ferramenta, Ã© uma decisÃ£o de arquitetura/UX que precisa
de confirmaÃ§Ã£o do usuÃ¡rio) â€” pode afetar usuÃ¡rios reais em conexÃµes
lentas, nÃ£o sÃ³ o teste automatizado.

**Primeiro teste** (`e2e/demo-dashboard.spec.ts`): fluxo "dados de
demonstraÃ§Ã£o" completo (carregamento â†’ clique em "Ver demonstraÃ§Ã£o" â†’
tela de revisÃ£o â†’ "Gerar relatÃ³rio" â†’ painel com widgets visÃ­vel).
Escolhido por nÃ£o depender de upload de arquivo real (sem diÃ¡logo
nativo do SO, que o Playwright evita via `setInputFiles`, mas manter o
primeiro teste o mais simples possÃ­vel fazia mais sentido). Rodado 4x
seguidas sem falha apÃ³s a correÃ§Ã£o da corrida de hidrataÃ§Ã£o.

**CI**: novo job `e2e` em `application.yml`, mesmo padrÃ£o estrutural do
`security-smoke` (sobe servidor, espera com curl, roda o teste, sobe
relatÃ³rio HTML do Playwright como artefato sÃ³ em caso de falha). Roda
em todo PR (mesmo gate que os outros dois jobs), decisÃ£o deliberada de
manter simples com "configurar" significando "rodar continuamente", nÃ£o
"disponÃ­vel mas nunca executado" â€” se o custo de CI/tempo virar problema
real, Ã© uma decisÃ£o futura de mover para `workflow_dispatch` manual.

Adicionado `.gitignore` para `playwright-report/` e `blob-report/`
(`test-results/` jÃ¡ estava ignorado, coincidÃªncia feliz com o nome
padrÃ£o do Playwright para artefatos de execuÃ§Ã£o).

Verificado localmente: `npx tsc --noEmit` limpo tanto no projeto
principal quanto isolado para `playwright.config.ts`/`e2e/*.ts` (fora do
`tsconfig.json` principal, que sÃ³ inclui `src/**`), `npx eslint .` sem
erros novos (sÃ³ o ruÃ­do de CRLF prÃ©-existente), Prettier limpo, YAML do
workflow validado com `js-yaml`, `npx vitest run` confirma que
`vitest.config.ts` (`include: ["src/**/*.test.ts"]`) nÃ£o pega os
arquivos `.spec.ts` do Playwright, `npm run build` e `npm run
performance:check` sem nenhuma mudanÃ§a de tamanho (dependÃªncia de
desenvolvimento). O job de CI em si sÃ³ pode ser verificado de fato
rodando no GitHub Actions â€” a mesma sequÃªncia de comandos foi executada
manualmente aqui antes de propor a PR, mas o runner `ubuntu-latest` real
Ã© a prova final.

**Segunda descoberta real, encontrada sÃ³ ao rodar de verdade no GitHub
Actions**: a primeira tentativa desta PR falhou nos trÃªs jobs do CI
(inclusive os dois que nem tocam em Playwright) logo na etapa `npm ci`,
com `Missing: lru-cache@11.5.2 from lock file`. Causa: `npm 11` (versÃ£o
instalada neste ambiente local) e `npm 10` (bundlado no Node 22 que a CI
usa) resolvem de forma diferente uma dependÃªncia **opcional** de
`nitro`/`unstorage` (`lru-cache` como peer dependency opcional) â€” o
npm 11 omite silenciosamente a entrada resolvida do lockfile ao rodar
`npm install`, o que Ã© vÃ¡lido para o prÃ³prio npm 11 (`npm ci` local
funciona normalmente), mas quebra `npm ci` na CI porque o npm 10 exige
essa entrada presente. `git checkout origin/main -- package-lock.json`
seguido de `npx npm@10 install --package-lock-only` (em vez do `npm
install` padrÃ£o deste ambiente) reproduziu exatamente a mesma resoluÃ§Ã£o
que a CI espera â€” diff mÃ­nimo e puramente aditivo (12 linhas), sem
remover nada. **LiÃ§Ã£o para sessÃµes futuras**: qualquer alteraÃ§Ã£o de
dependÃªncias neste projeto deve rodar `npx npm@10 install` (ou a versÃ£o
de npm que o `node-version` do workflow realmente bundla) em vez do
`npm install` padrÃ£o do ambiente local, e sempre confirmar com um `rm
-rf node_modules && npm ci` limpo antes de considerar a mudanÃ§a
prÛ^øÖÚ$z{-®éÜj×KYš^›ÜÈ˜\œ]Z]›ÜÈØØYÜÈ
XZ\ÈÚXØYÙ[HÔ“‹\ØY™HÈ™]Y\ŠH\›İ˜YÜË‚‚“Y\ØÛYHÛÛ[ÈÔˆÌLÎJÎ‹ËÙÚ]X‹˜ÛÛKÛÛ]™MÛÛ\]X[YYKÜ[ÌLÎ
B™\Ú\ÈHÙÜÈÜÈÚXÚÜÈHÒH\ÜØ\™[H
L‘H^]ÜšYÚ[İ\İØZ[Âœ\™›Ü›X[˜ÙKÙXİ\š]HXY\œË™\˜Ù[
HH]]Üš^˜péğèÛÈ^0ëXÚ]HÂ\İpè\š[ËˆXZ[ˆ]˜[°éÛİHHMLÌM™\˜HNYXÎ‚‚ˆÈÈLKˆÛÜœšYÚYÈÈÙYİ[™È›Ü]YZ[Èœ\›X[™[HˆÖHYÛÜ˜H™\Ù\˜[HÈÛÛ[U\HH[Ù[ÈH™\™YK°èÛÈš\˜[HŞËÛH\Ù˜\°éØYÂ‚‘\Ú\ÈHÙpéğèÛÈL
ÓJKÈ\İpè\š[È\™İ[İHœ™XÚ\ÛÈ]Y\ˆHXÈ‚œÛØœ™HH[Z]péğèÛÈ™\İ[HØİ[Y[YH[HĞTÓWÔ“ÓSÕSÓ—ĞÔ’UT’PK›Y‚˜HØpëYHØ[š]^˜YHH[HØXÙ[\™HÜ˜]˜]˜HŞØÛX™H™\™YK[0èÛÈ[˜ØHÛÛ]˜HÛÛ[È›ÛH™X[›ÈØ]H\ÜXğëYšXÛÂ™\ÜÙ\ÈÚ\È›Ü›X]ÜÈ8 %ğìÈ[\X]˜H\È›Û\ÈÈØ]HŞØÛX°èBœİ\\˜YËˆHØ]\ØH˜Z^ˆ\˜HHY\ÛXHHÙ[\™NˆÈÚY]”È[œİ[YÈğìÂœØX™H
Š™\ØÜ™]™\ŠŠˆ›ÛÚÕ\XŞØÛX
ÖÜš]X[°éØB˜[œ™XÛÙÛš^™Y›ÛÚÕ\H˜H]X[]Y\ˆİ]›È˜[ÜŠK‚‚’[™\İYØpéğèÛÎˆ›ØØ\ˆHXˆ[Z\˜H
ŞÔÚY]”ÊHÙ\šXH\Ü›ÜÜ˜Ú[Û˜[™H\œš\ØØYÈ8 %0êHH\[™0ê›˜ÚXH\ØYH[HÙHH[\ÜpéğèÛÈ™X[È\°èÛÂœğìÈ›ÈØ[š]^˜YÜ‹HH™\œğèÛÈ[œİ[YH
ŒŒŒØ
H°èH0êHHZ[]X[BÑˆÙšXÚX[°èÛÈ[XH™\œğèÛÈ\Ø]X[^˜YH\Ü\˜[™È\]NÈHXİ[˜HB™\ØÜš]HH›ÛÚÕ\XH[\]H0êHÛÛšXÚYHH°ìÜšXHX‹ˆ[œÜXÚ[Û˜[™Â›ÈĞÛÛ[Õ\\×K[Ù\˜YÈ
[š\Ş[˜ØšXH™›]X°èH\[™0ê›˜ÚXHÂœ›Ú™]ÊKHY™\™[°éØHÓÖS™X[[™H[HÛÜšØ›ÛÚÈ™Øİ[Y[ÈˆHÂˆ›[Ù[Èˆ\]Z]˜[[H0êHğìÈHXÛ\˜péğèÛÈHÛÛ[U\HH\B˜ŞİÛÜšØ›ÛÚË[8 %‹‹œÜ™XYÚY][œÚY]›XZ[ŠŞ[œË‚˜‹‹œÜ™XYÚY][[\]K›XZ[ŠŞ[
HÈ\ˆXXÜ›ËY[˜X›Y\]Z]˜[[Bœ˜HX
KˆÙÈÈ™\İÈÈ’T
ğê[[\Ë°ìÜ›][\Ë\İ[ÜË\\›[šÜÂœ™[[İšYÜË]ËŠH°èH\˜HY0ê›XÛË‚‚ŠŠÛÜœ™péğèÛÊŠˆ
Y\ÛXHœ˜[˜ÚHÙpéğèÛÈLš^ÜØ[š]^™K][\]KY›Ü›X]ØœÙ[HY\™ÙHZ[™JNˆØ[š]^™UÛÜšØ›ÛÚĞ]\ØÜ˜]˜HÛÛHÈ›ÛÚÕ\X™X[]YB›ÈÚY]”Èİ\ÜH
Ş\˜HÛX\˜HX
HKğìÈ]X[™Â˜HÜšYÙ[HYYH0êH[H[Ù[Ë™XXœ™HÈ’T™\İ[[HÛÛH[š\Ş[˜ØÂ˜š\Ş[˜Ø
™›]X
H˜H›ØØ\ˆ\ÜØH0î›šXØHİš[™È›Â˜ĞÛÛ[Õ\\×K[[\ÈH]›Û™\ˆÜÈ]\È8 %˜YHXZ\È›È’T0êBØØYËˆØÜš\ËÜØ[š]^™K]ÛÜšØ›ÛÚËXÛÜœ\Ë›ZœØÚ[\YšXÛİNˆÈX\B™^[œğèÛø¡¤˜›ÛÚÕ\XYÛÜ˜H0êHY[YYH
8¡¤˜˜˜X8¡¤˜H˜
K[0èÛÈÈ›ÛYHÈ\œ]Z]›ÈHØpëYHHÈØ[\È›Ü›X]™ÈX[šY™\İÈ\Ø[HH^[œğèÛÈ™X[°èÛÈXZ\ÈŞØŞ˜\Ù˜\°éØYË‚‚•˜[YYÈX[X[Y[HÛÛH[š\Ş[˜Ø[\ÈH\ØÜ™]™\ˆÈ\İNˆÈ’Tœ™\İ[[HH[XHÜšYÙ[HÚ[0ê]XØH[B˜ÛÛ[\OH˜\XØ][Û‹İ›™›Ü[[›Ü›X]Ë[Ù™šXÙYØİ[Y[œÜ™XYÚY][[\]K›XZ[ŠŞ[˜›˜H\HŞİÛÜšØ›ÛÚË[
°èÛÈXZ\ÈœÚY]›XZ[ŠŞ[
K™XXœ™B››Ü›X[Y[H›ÈÚY]”ËHÈÛÛpî™ÈØ[š]^˜YÈ\›X[™XÙH[XİËˆY\Û[Â\İH˜HX
\XØ][Û‹İ›™›\ËY^Ù[[\]K›XXÜ›Ñ[˜X›Y›XZ[ŠŞ[
K˜ÛÛ™š\›X[™È[X°ê[H]\ğê›˜ÚXHH˜˜T›Ú™XİHH]X[]Y\ˆ\ÜÚ[˜]\˜B˜]šX]H—Ó˜[YX›È’T
Y\ÛXH›İ˜H°èH\ØYH˜HÛX˜HÙpéğèÛÂL
KˆÛ[ÚÙH\İX[X[HÓHÛÛ\]HÛÛ™š\›[İHØ[š]^™YLKŠ™›Ü›X]ˆ˜
HHØ[š]^™YL‹X
™›Ü›X]ˆH˜
H›Â›X[šY™\İË›Ü˜HÈ™\ÜÚ]0ìÜš[ÈH\YØYÈ\Ú\Ë‚‚”›İ˜HH™YÜ™\ÜğèÛÈ[HÜ˜ËÛX‹İÛÜšØ›ÛÚË\Ø[š]^™\‹\İØˆˆ\İ\Â››İ›ÜÈ
HX
KØYH[H[œÜXÚ[Û˜[™ÈÈĞÛÛ[Õ\\×K[˜]HH]H˜HÛÛ™š\›X\ˆHİš[™ÈHÛÛ[U\H›ØØYHH]\Ù[HB˜[YØKˆÈ\İH[YÛÈ]YH™\šYšXØ]˜HH™Xİ\ØHH›ÛÚÕ\Nˆ˜˜ÛÛ[È[°è[YÈ›ÚH]X[^˜YÈ8 %˜YÛÜ˜H0êH[H˜[Üˆ°è[YË[0èÛÈÂ\İHH™Z™ZpéğèÛÈ\ÜÛİHH\Ø\ˆØˆ˜
›Ü›X]Èš[°è\š[ÈYØYË]YHÂ”ÚY]”È[œİ[YÈ[X°ê[H°èÛÈØX™H\ØÜ™]™\ŠH˜HÛÛ[X\ˆ›İ˜[™È]YB˜›ÛÚÕ\XÈ™X[Y[H°èÛÈİ\ÜYÜÈğèÛÈ™Z™Z]YÜÈ^XÚ][Y[K‚‚‘Øİ[Y[péğèÛÈ]X[^˜YNˆØÜËÕĞTÓWĞÓÔ”T×ÔĞS’UVUSÓ‹›YB˜ØÜËÕĞTÓWÔ“ÓSÕSÓ—ĞÔ’UT’PK›Y°èÛÈ\ØÜ™]™[HXZ\ÈÖHÛÛ[Â˜›Ü]YZ[È\›X[™[HÙ[HØ[Z[šÈHÛÜœ™péğèÛÈ8 %YÛÜ˜H0ê›HÈY\Û[È\ÈBœ[™0ê›˜ÚXH]YHÖ°èHİ\\›İH
ğìÈ˜[H\œ]Z]›È™X[È\İpè\š[ÊK‚‚ŠŠ”™\İ[YÈ0ë\]ZYÊŠˆÜÈ]X]›È›Ü›X]ÜÈÓÖSİ\ÜYÜÈ
ÖÓK–JH°èÛÈ0ê›HXZ\È™[š[H›Ü]YZ[È\İ]\˜[›ÈØ[š]^˜YÜˆB˜ÛÜœ\ËˆÓKÖÖHÛÛ[X[H[HÍH›ÈØ]HH›Û[ğéğèÛÈ8 %\[™[BœğìÈH\œ]Z]›È™X[ÚYØ[™ËY\Û[È\ÈHXİ[˜H]YHÖ°èH™XÚİBŠ‹ÍJKˆœš]\İ[˜
MH\ÜÛİKH[YÈ8 %ˆ\İ\È›İ›ÜÈ\İBœÙpéğèÛÊKœØÈK[›Ñ[Z]œ\Û[KYš^›ÜÈ\œ]Z]›ÜÈØØYÜÈB˜ÚXØYÙ[HÔ“‹\ØY™HÈ™]Y\ˆ\›İ˜YÜË‚‚“Y\ØÛYHÛÛ[ÈÔˆÌLÎWJÎ‹ËÙÚ]X‹˜ÛÛKÛÛ]™MÛÛ\]X[YYKÜ[ÌLÎJB™\Ú\ÈHÙÜÈÜÈÚXÚÜÈHÒH\ÜØ\™[HH]]Üš^˜péğèÛÈ^0ëXÚ]HÂ\İpè\š[ËˆXZ[ˆ]˜[°éÛİHHNYXÎ\˜HXÎLÙ˜‚‚ˆÈÈL‹ˆ]Y]ÜšXHHÙYİ\˜[°éØKÜš]˜XÚYYHHYYÈÈ\İpè\š[Îˆ™[[İšYÈÛÛ\Û™[HÚYÛ‹İZH[ÜÈÛÛH[™Ù\›İ\ÛTÙ][›™\’S‚•\İpè\š[ÈY]H˜Hš[Üš^˜\ˆÙYİ\˜[°éØKÜš]˜XÚYYH[œ]X[ÈÈØ]HÓKÂ–ÖH\Ü\˜H\œ]Z]›È™X[ˆ[™\İYØpéğèÛÈ
°èÛÈ[HØØ[›™\ˆÙ[°ê\šXÛËZ]\˜B™\™]HÈğìÙYÛÊNˆÔÔÙ[‹ZÜİYÙ[HÚ[Ø\™[HØÜš\\Ü˜ØØİ[K\Ü˜Ø˜Øš™Xİ\Ü˜È	Û›Û™IØœ˜[YKX[˜Ù\İÜœÈ	Û›Û™IØ
\ÙXİ\š]KØ
NÈÛÛÚÚY\Â™HÙ\ÜğèÛÈÛ›XØØ[YTÚ]OTİšXİÈÚXØYÙ[HHÜšYÙ[H[H›İ\ÈHTBŠ\ÔØ[YSÜšYÚ[œ›İÜÙ\”™\]Y\İ
NÈÛÛœİpéğèÛÈÈ^[ØY[šXYÈ[ÈÙ[Z[šH°èB™š[˜HÔ‹ĞÓ”‹Ù[XZ[İ[Y›Û™HÜˆ™YÙ^H›ÛYHHÛÛ[˜HHH˜[Ü‹™\˜H^[\ÜÈHÛÛ[˜HÙ[œğë]™[[Hš[›È[H›Û\Z[š™Xİ[Û‹BŠŠœ™]˜[YH›ÈÙ\šYÜŠŠˆ[H™^ˆHÛÛ™šX\ˆ›ÈÙ[œÚ]]™XØ[İ[YÈ[Â˜ÛY[
ÛX\Z[\ÜØ˜[Y]TÛX\[\Ü[œ]
NÈ[ÙÈš]˜XÚYYB™Ü˜]˜H[HÙ\ÜÚ[Û”İÜ˜YÙX[H™^ˆHØØ[İÜ˜YÙX
İÜ˜YÙKØ
NÈœB˜]Y]K\›ÙXİ[Û˜Ù[H[™\˜Xš[YY\ËˆÜİ\˜HÙ\˜[°èHXY\˜K‚‚‘Ú\ÈXÚYÜÈÛÛ˜Ü™]ÜË°èÛÈpìÜšXÛÜË™\ÜYÜÈ[È\İpè\š[Î‚‚ŒKˆ
ŠğìÙYÛÈ[ÜÈÛÛHÚ[šÈHSĞÔÔÈ°èÛÈ\ØØ\YÊŠ‚ˆÜ˜ËØÛÛ\Û™[ËİZKØÚ\Ş
Ú\ÛÛZ[™\˜ØÚ\İ[X›Ú[\œ]BˆÈÚYÛ‹İZJH[\œÛ]˜HÙ^XØÛÛÜ˜H[HÚ\ÛÛ™šYØ\™]È[›ÂˆH[Hİ[H[™Ù\›İ\ÛTÙ][›™\’S˜Ù[H\ØØ\\‹ˆÛÛ™š\›XYÈÜˆ\ØØBˆH[\ÜpéğèÛÈ
œ›ÛHØÛÛ\Û™[ËİZKØÚ\˜H˜\šX[\ÊH]YH
Š›™[š[BˆÚYÙ]™X[\ØH\ÜÙH\œ]Z]›ÊŠˆ8 %ÙÈÈ\[\ÜH™XÚ\Ø\™]È[BˆÚYÙ]XØ\™Şˆ°èÛÈ0êH^Ü°è]™[Ú™H
˜YH[[Y[H\ÜÙHÛÛ\Û™[BˆÛÛHYÈÈ\İpè\š[ÊKX\È0êH[XH\›XY[NˆÙH[İ[HXH[İpê[H™[YØ\ˆÂˆÛÛ\Û™[HÛÛH›ÛY\ÈHØ]YÛÜšXKÜğê\šYHš[™ÜÈH[š[H
YÈ°èÛÂˆÛÛ™špè]™[ÜˆYš[špéğèÛË0êHÈ›Ü0ìÜÚ]ÈÈ\
Kš\˜H[š™péğèÛÈHSšXBˆ]YXœ˜HÈİ[O˜Ù[H™[š[H]š\ÛË‚Œ‹ˆ
Š˜ØÜš\\Ü˜È	ÜÙ[‰È	İ[œØY™KZ[›[™IØ›ÈÔÔ
Šˆ˜Y[Ù™ˆ°èHØİ[Y[YÂˆ›È°ìÜš[ÈğìÙYÛÈ
\ÙXİ\š]KÎŒLLL˜
HÛÛ[È[\Ü°è\š[È]0êHÂˆ[”İXÚÈİ\^Üˆ›Û˜ÙH˜HY˜]péğèÛËˆ™YÚ\İ˜YÈÛÛ[È[™0ê›˜ÚXKˆ°èÛÈ[\[Y[YÈ™\İHÙ\ÜğèÛÈ
\İpè\š[Èš[Üš^›İHÈ][HJK‚‚ŠŠÛÜœ™péğèÛÈ\XØYJŠˆ
][HKœ˜[˜Ú™[[İ™K][\ÙYXÚ\XÛÛ\Û™[œÙ[HY\™ÙHZ[™JNˆ\œ]Z]›ÈÜ˜ËØÛÛ\Û™[ËİZKØÚ\Ş[]YÈÜ‚š[Z\›È8 %ÛÛ™š\›XYÈÙ[H™[š[XH[\ÜpéğèÛÈ[HYØ\ˆ™[š[HÈÜ˜ËØBœÙ[H\İH°ìÜš[ÈÛØœš[™Ë[Ë[0èÛÈ°èÛÈ0èHØ[Z[šÈHÛÛ\]Xš[YYHBœ™\Ù\˜\‹ˆœØÈK[›Ñ[Z]œš]\İ[˜
MH\ÜÛİKH[YËœÙ[H]Y[°éØHHÛÛYÙ[H8 %™[š[H\İH\[™XHÈ\œ]Z]›ÊKœH[‚˜Z[HœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÜÈÙ[H™YÜ™\ÜğèÛÈ
\œ]Z]›È°èB›°èÛÈ[˜]˜H[H™[š[H[™KÜˆ°èÛÈÙ\ˆ[\ÜYÊK‚‚ŠŠ”[™0ê›˜ÚXH™YÚ\İ˜YK°èÛÈ[\[Y[YJŠˆ\\\ˆØÜš\\Ü˜ØÈÔÔœ™[[İ™[™È[œØY™KZ[›[™X\[™HHÈ[”İXÚÈİ\^Üˆ›Û˜ÙHBšY˜]péğèÛÈ8 %ÚXØ\ˆH™\œğèÛÈ[œİ[YH[\ÈH[\‹0êH]Y[°éØHXZ\Â™[XØYH
Y^H[HÙH0èYÚ[˜JHH°èÛÈ›ÚHYYH˜H\İHÙ\ÜğèÛË‚‚ˆÈÈLËˆ][HÈÈ˜XÚÛÙÈ[\[Y[YÎˆØÜš\\Ü˜ØÈÔÔYÛÜ˜H\ØH›Û˜ÙHÜˆ™\]Z\ÚpéğèÛËÙ[H[œØY™KZ[›[™X‚•\İpè\š[ÈY]H˜H›ÜÜÙYİZ\ˆÛÛHÈ][HÈ™YÚ\İ˜YÈ˜HÙpéğèÛÈL‹‚’[™\İYØpéğèÛÈÛÛ™š\›[İH]YHH™\œğèÛÈ[œİ[YBŠ[œİXÚËÜ™XXİ\İ\KŒMØ[œİXÚËÜ™XXİ\›İ]\KŒMÌŒN
H°èBœİ\ÜH›İ]\‹›Ü[ÛœËœÜÜ‹››Û˜ÙXH™\™YH8 %YÈ[HØÜš\ËšœØ˜ØÜš\Û˜ÙKšœØH\ÜÙ]šœØÈXÛİH
›ÙWÛ[Ù[\ËĞ[œİXÚËÜ™XXİ\›İ]\‹Ù\İÙ\ÛKØ
K‚“Èœ˜[Y]ÛÜšÈ[H[˜Û\Ú]™HÙ]H°ìÜš[ÈYXØ[š\Û[ÈH™XÛÛ˜Ú[XpéğèÛÈH›Û˜ÙB››ÈÛY[Nˆ™[™\š^˜HY]H›Ü\OH˜ÜÜ[›Û˜ÙHˆÛÛ[H‹‹‹ˆ˜›ÈS™HÈ›Ûİİ˜\ÈÛY[H0êˆ\ÜÙH˜[ÜˆšXHØİ[Y[œ]Y\TÙ[XİÜ˜˜B›X[\ˆ›İ]\‹›Ü[ÛœËœÜÜ‹››Û˜ÙXÛÛœÚ\İ[H˜HY˜]péğèÛÈ8 %\ØÛØ™\Âš[œÜXÚ[Û˜[™ÈÈ[™HH›ÙpéğèÛÈ\Ú\ÈÈZ[°èÛÈØİ[Y[péğèÛË‚‚ŠŠ‘\ØYš[È™X[
ŠˆÜ˜ËÜ›İ]\‹Ş
Ù]›İ]\Š
X
H0êHÈ0î›šXÛÈÛÈB˜ÜšXpéğèÛÈÈ›İ]\‹ÛÛ\\[YÈ[™HÙ\šYÜˆ
Ú[XYÈœ™\ØÛÈHØYBœ™\]Z\ÚpéğèÛÈÜˆÜ™X]Tİ\[™\˜È[œİXÚËÜİ\\Ù\™\‹XÛÜ™X˜ÛÛ™š\›XYÈ[™ÈÜ™X]Tİ\[™\‹šœØ
HHÛY[H
Y˜]péğèÛÊKˆ[B››Û˜ÙHÜˆ™\]Z\ÚpéğèÛÈ°èÛÈÙHÙ\ˆ\ÜØYÈÛÛ[È\°è›Y]›È8 %Ù]›İ]\Š
X›°èÛÈ™XÙX™H™\]Y\İ™[š[K0êH[›ØØYÈ[Èœ˜[Y]ÛÜšÈ[\›˜[Y[KˆHÂ˜[Üˆ[H]YH˜]\ˆ^][Y[H[™HÈØÜš\›Û˜ÙOH‹‹‹ˆ˜™[™\š^˜YÂ™HÈXY\ˆÛÛ[TÙXİ\š]KTÛXŞXH™\ÜÜİKİHÈØÜš\BšY˜]péğèÛÈ]YXœ˜HHH0èYÚ[˜H[Z\˜HšXØH[Hœ˜[˜ÛË‚‚ŠŠ”ÛÛpéğèÛÊŠˆY\Û[ÈY°èÛÈH\Ş[˜ÓØØ[İÜ˜YÙX°èH\ØYÈHÛÛ\›İ˜YÈ[B˜\œ›Ü‹XØ\\™KØ˜H^][Y[H\ÜÙH\ÈH›Ø›[XH
\İYÈÜ‚œ™\]Z\ÚpéğèÛÈ™XÚ\Ø[™È]˜]™\ÜØ\ˆÚ[XY\È[\›˜\ÈÜXØ\ÈÈœ˜[Y]ÛÜšÊK‚“›İ›ÈpìÙ[ÈÜ˜ËÛX‹ØÜÜ[›Û˜ÙKØ
Ù[™\˜]S›Û˜ÙXØ[•Ú]›Û˜ÙXÂ˜İ\œ™[›Û˜ÙXÙ\™\‹[Û›H8 %\ØH›ÙN˜\Ş[˜×ÚÛÚÜØØ›ÙN˜Ü\Ø
K‚˜Ù\™\‹ØÙ\˜HÈ›Û˜ÙH[XH™^ˆ›ÈÜÈÈ™]Ú

XH[›Û™HÙHBœ™\]Y\İÛÛH[•Ú]›Û˜ÙX
[š[šYÈÛÛH[•Ú]\œ›ÜØ\\™X°èB™^\İ[K[X›ÜÈTŞ[˜ÓØØ[İÜ˜YÙH[™\[™[\ËÙ[HÛÛ™›]ÊK\ÜØ[™Â›ÈY\Û[È˜[Üˆ^XÚ][Y[H˜\ÈÚ[XY\ÈHÚ]ÙXİ\š]RXY\œØ‚‚ŠŠ”š\ØÛÈ\ÜXğëYšXÛÈ™\ÛÛšYÊŠˆ›İ]\‹Ş›ÙH[È›È[™HÂœÙ\šYÜˆ]X[È›È[™HÈÛY[H
[\ÜYÈÜˆ[X›ÜÈšXHÛÛ™[°éğèÛÂ™Èœ˜[Y]ÛÜšÊKX\ÈÜÜ[›Û˜ÙKØ\ØH›ÙN˜\Ş[˜×ÚÛÚÜØØ›ÙN˜Ü\Øœ]YH]YXœ˜\šX[HÈ[™HÈ˜]™YØYÜˆÙH[\ÜYÜÈ\İ]XØ[Y[Kˆš^‚˜[\Ü

X[°è›ZXÛÈ]°è\ÈH[HİX\™[\Ü›Y]K™[‹”ÔÔ˜8 %Èš]BœİXœİ]ZH\ÜÙH˜[ÜˆÜˆ[H]\˜[›ÛÛX[›È[H[\ÈHZ[HÂ”›Û\[[Z[˜HÈœ˜[˜Ú[Z\›È
[\Ü[°è›ZXÛÈ[˜Û\ÛÊHÈ[™HÂ˜ÛY[H]X[™ÈHÛÛ™péğèÛÈ0êH\İ]XØ[Y[H˜[ÙXˆ
Š•˜[YYË°èÛÈğìÂ˜\Üİ[ZYÊŠˆ\Ú\ÈÈœH[ˆZ[Ü™\\›˜\Ş[˜×ÚÛÚÜ×\Ş[˜ÓØØ[İÜ˜YÙHˆ™\˜Ù[Ûİ]]Üİ]XËÊŠ‹Ê‹šœØ›°èÛÈ™]Ü››İH™[š[H\œ]Z]›È8 %ÈpìÙ[ÈÙ\™\‹[Û›H°èÛÈ˜^˜H›È[™B™È˜]™YØYÜ‹ˆ\ÙXİ\š]KØØ[šİHZ[ÙXİ\š]RXY\œÊ›Û˜ÙOÊX‚˜ÛÛH›Û˜ÙKØÜš\\Ü˜È	ÜÙ[‰È	Û›Û˜ÙKO˜[Ü‰ØÈÙ[H›Û˜ÙH
Ú[XYH\™]B™[H\İKÜˆ^[\ÊKØZHH›ÛH˜H	İ[œØY™KZ[›[™IØ8 %[˜ØH[Ü‚œ]YHÈÛÛ\Ü[Y[È[\š[Üˆ0è]Y[°éØK‚‚ŠŠ•™\šYšXØpéğèÛÈ[™]ËY[™
Šˆ
°èÛÈğìÈ\İ\È[š]0è\š[ÜËYÈÈš\ØÛÈBœ]YXœ˜\ˆH0èYÚ[˜H[Z\˜JNˆİXšYÈœH[ˆ]˜H™\™YHH[œÜXÚ[Û˜YÂšXHœ›İÜÙ\ˆ[™H8 %Y]H›Ü\OH˜ÜÜ[›Û˜ÙH˜™\Ù[HÛÛH˜[Üˆ°èÛÂ˜^š[ÎÈØİ[Y[œ]Y\TÙ[XİÜ[
	ÜØÜš\	ÊVÌK››Û˜ÙX
›ÜšYYYHQ›°èÛÈÙ]]šX]X8 %˜]™YØYÜˆ\ØÛÛ™HÈ]šX]ÈH›Ü0ìÜÚ]È\Ú\Âœ]YHÈ[[Y[È[˜H›ÈÓJH˜]H^][Y[HÛÛHÈ˜[ÜˆHY]HYÎÂšXY\ˆÛÛ[TÙXİ\š]KTÛXŞXH™\ÜÜİH™X[
İ\›
H[Üİ˜B˜ØÜš\\Ü˜È	ÜÙ[‰È	Û›Û˜ÙKO˜[Ü‰ØÙ[H	İ[œØY™KZ[›[™IØÈ™\›Âš[ÛpéğèÛÈHÔÔ›ÈÛÛœÛÛNÈÛ\]YH[H]]˜\ˆ[ÙÈš]˜YÈˆ
ÙÙÛH]YB™\[™HH[™\ˆH]™[È™XXİ[˜Ú[Û˜[™È0ìÜËZY˜]péğèÛÊHÙ[H\œ›Â›™[š[Kˆœ^]ÜšYÚ\İ
İpë]HL‘HÛÛ\]JH\ÜÛİHÛÛ˜HÂ›Y\Û[È]ˆÙ\™\‹‚‚˜ØÜš\ËÜÙXİ\š]K\Û[ÚÙK›ZœØ
›ÙYÈ˜HÒHHØYHŠHğìÈÚXØ]˜B˜œ˜[YKX[˜Ù\İÜœÈ	Û›Û™IØHİXœİš[™ÈÛÛÈ›ÈÔÔ8 %°èÛÈ˜[Y]˜B˜ØÜš\\Ü˜Ø™[š[Kˆ›Ü[XÚYÎˆYÛÜ˜H˜[HÙHØÜš\\Ü˜Ø°èÛÈ]™\‚˜	Û›Û˜ÙKK‹‹‰ØH˜[HÙHØÜš\\Ü˜Ø\ÜXÚYšXØ[Y[HZ[™H]™\‚˜	İ[œØY™KZ[›[™IØ
ÚXØYÙ[HÜˆ™YÙ^›ÈÙYÛY[ÈØÜš\\Ü˜Ø°èÛÈBœİš[™È[Z\˜H8 %İ[K\Ü˜ØÛÛ[XHÛÛH	İ[œØY™KZ[›[™IØBœ›Ü0ìÜÚ]Ë[˜[\˜YÊKˆ›ÙYÈH™\™YHÛÛ˜H]ˆÙ\™\ˆ™X[šXB˜\Ú
°èÛÈœ›İÜÙ\ˆ[™H8 %˜[Y\ÜXÙ\ÈH™YH\ÛÛYÜË™\ˆ\›XY[HÌ‚™HÙ\ÜğíY\È[\š[Ü™\ÊH[\ÈHÛÛ[Z]\ˆ\›İ˜YË‚‚•\İ\È›İ›ÜÎˆÜ˜ËÛX‹ØÜÜ[›Û˜ÙK\İØ
Ù\˜péğèÛË\ÛÛ[Y[ÈÜ‚˜\Ş[˜ÓØØ[İÜ˜YÙX[˜Û\Ú]™H[™HÚ[XY\ÈÛÛ˜ÛÜœ™[\ËY\Û[ÈY°èÛÂ™H\İH°èH\ØYÈ›È\œ›Ü‹XØ\\™KØ
HHÜ˜ËÛX‹Ú\ÙXİ\š]K\İØŠÔÔÛÛKÜÙ[H›Û˜ÙJKˆœš]\İ[˜
MMH\ÜÛİKH[YÈ8 %ˆ\İ\Â››İ›ÜÊKœØÈK[›Ñ[Z]
XÚİHHÛÜœšYÚ]H[H\œ›È™X[B˜^XİÜ[Û˜[›Ü\U\\Ø8 %ÜÜˆÈ›Û˜ÙNˆ[™Yš[™YX°èÛÈ0êHHY\ÛXB˜ÛÚ\ØH]YHÛZ]\ˆÜÜ˜[Z\›ËÛÛH\ÜÙH›YÈYØYÊKœ\Û[KYš^ŠÈ™]Y\ˆÔ“‹\ØY™H›ÜÈÈ\œ]Z]›ÜÈØØYÜËœH[ˆZ[
ÛY[˜[™HÛÛ™š\›XYÈ[\ÊHHœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÜË‚‚ŠŠ”™\İ[YÈ0ë\]ZYÊŠˆÈ0î›šXÛÈ][HÛÛšXÚYÈHÙYİ\˜[°éØKÜš]˜XÚYYBœ™YÚ\İ˜YÈ›È˜XÚÛÙÈ\İHÙ\ÜğèÛÈ\İ0èH™\ÛÛšYËˆÔÔØÜš\\Ü˜Ø°èÛÂ˜[[˜ÚXHXZ\È	İ[œØY™KZ[›[™IØ[H™[š[XH™\ÜÜİHÈÙ\šYÜ‹œ™Y^š[™ÈH™\™YHHİ\\™°ëXÚYHHÔÈ]YHHÙpéğèÛÈLˆ\ÛİHÛÛ[Â›Z]YØYHğìÈ\˜ÚX[Y[H
ÈÛÛ\Û™[H[ÜÈ›ÚH™[[İšYËX\ÈÈÔÔ˜ÛÛ[X]˜H\›Z][™È]X[]Y\ˆØÜš\[›[™H]0êH\İHÙpéğèÛÊK‚‚ˆÈÈMˆš[YZ\˜H˜]XHH]š\ğèÛÈHÚYÙ]XØ\™Ş
MLHĞ‹ŒÍMÈ[š\È[XH[°éğèÛÈğìÊNˆH\ÜÈHÚYÙ]^˜pëYÜËÎÈ[š\È™[[İšY\Â‚•\İpè\š[È\ÛİHÚYÙ]XØ\™ŞÛÛ[ÈÈ°ìŞ[[ÈØ[™Y]È›ÜHB™]š\ğèÛÈ8 %]Z]ÈXÚ[XHÜÈ[XZ\ÈÛÛ\Û™[\È[H[X[šËÛÛ˜Ù[˜[™Â˜›ØH\HHÛÛ\^YYHš\İX[HH™YÜ˜\ÈÜÈÚYÙ]ËˆY]Bœ™\\péğèÛÈ[HİX˜ÛÛ\Û™[\ËÚÛÚÜÈHXZ\È\İ\È›ØØYÜË‚‚ŠŠ‘\ØÛØ™\H]YH]YİHÈ›Ü›X]ÈH]š\ğèÛÊŠˆÈ\œ]Z]›È°èÛÈ0êH[XB˜ÛÛpéğèÛÈHÛÛ\Û™[\È8 %0êH[XH[°éğèÛÈ0î›šXØH
ÚYÙ]Ø\™
HHŒÌÍL›[š\ÈÛÛHMœ˜[˜Ú\ÈYˆ
Ë\HOOH‹‹ŠXÙ\]Y[˜ÚXZ\Ë™\›Â˜\ÙSY[[ØØ\ÙPØ[˜XÚØØ\ÙQY™™Xİ
YÈ™XÛÛ\]YÈÜˆ™[™\‹Y\Û[Â™[›ÈHØYHœ˜[˜Ú
HH
Š™\›È\İJŠˆÛØœš[™ÈÈ\œ]Z]›È[Z\›Ë‚“X\XYÈH[™È
šXHİX˜YÙ[H^Ü™JH[\ÈHØØ\ˆ[H]X[]Y\‚›[šNˆ›ÜË\İYË[™\œË\İ]\˜HH™[™\š^˜péğèÛÈÜˆ\Ë˜Ú›ÛYHÛÛ\\[YÈ
\XÛO˜
ÈÚYÙ]XY
È˜YÔ›ÜØ
Â˜Ú^™PÛÛ›ÛØ]X\ÙHY0ê›XÛÈ[HÙHœ˜[˜Ú
HHÛÛ˜Ù\›œÈÜ^˜YÜÂŠ™\ÛÛpéğèÛÈHØ[\ËØYÜ™YØpéğèÛÈ\XØYH]X\ÙH]\˜[Y[HÈÛ\]YKBœ\˜KYš[˜\ˆ\XØYÈ[HŠÈœ˜[˜Ú\ÊK‚‚ŠŠ‘XÚ\ğèÛÈH\ØÛÜÊŠˆYÈÈš\ØÛÈ™X[
ÛÛ\Û™[HH™[™\š^˜péğèÛÂ˜Ü°ë]XÛË\ØYÈ[H›ÙpéğèÛËÙ[H™[š[XH™YHHÙYİ\˜[°éØHH\İB[š]0è\š[ÊHHÈ[X[šÈÈ\œ]Z]›Ë]šY\ˆYÈH[XH™^ˆ[H0î›šXÛÂ™Y™ˆ[›Ü›YHH°èÛË\™]š\ğè]™[Ù\šXH\œ™\ÜÛœğè]™[ˆ[™YİYH[H˜]XBœ\]Y[˜KÛÛ\]HH™\šYšXØYH8 %HÜÈM\ÜÈHÚYÙ]^˜pëYÜÂ›™\İHÙ\ÜğèÛÈ
ÜÈXZ\È]]ØÛÛYÜËÙ[HÛÛ\\[\ˆ\İYÈÛÛHÈ›ØÛÂ™HÜ°èYšXÛÜÈ˜\œ˜KÜ^˜KÛ[šKğè\™XJKÛÛHÜÈH™\İ[\È^XÚ][Y[Bœ™YÚ\İ˜YÜÈÛÛ[È°ìŞ[XH˜]XK°èÛÈX˜[™Û˜YÜË‚‚ŠŠ‘^˜pëYÈ\˜H\œ]Z]›ÜÈ°ìÜš[ÜÊŠˆ
Ü˜ËØÛÛ\Û™[ËÛÛX[KØY\Û[ÂœY°èÛÈ°èH\ØYÈÜˆX\]ÚYÙ]X›ÙKŞØÜ\˜][Û˜[]ÚYÙ]X›ÙKŞ
N‚˜™\œÚ[Û‹XÛÛ\\™K]ÚYÙ]X›ÙKŞ]›İ]ÚYÙ]X›ÙKŞ
]›İ]X›BŠÈX]š^ZX]X\
K˜[šÚ[™Ë]ÚYÙ]X›ÙKŞ[œÚYÚË]ÚYÙ]X›ÙKŞ˜˜][™Ë]ÚYÙ]X›ÙKŞˆØYH[H0êH[HİXœİ]]ÈÛÛ\]ÈH]]ØÛÛYÂ™Èœ˜[˜ÚÜšYÚ[˜[[Z\›È
[˜Û\Ú]™HÈ°ìÜš[È\XÛO˜
ÈÚYÙ]XY›°èÛÈğìÈÈÛÛpî™È[\››ÊH8 %XÚ\ğèÛÈÛXYH\Ú\ÈH\ØÛØœš\ˆ]YB˜[İ[œÈœ˜[˜Ú\È
]›İ]X›KÛX]š^ZX]X\
H[\˜Ø[[HÚ›ÛYHÙ[°ê\šXÛÂŠÚ^™PÛÛ›ÛØ
HÛÛHÛÛ˜\ˆ\ÜXğëYšXØHÈ\Ë[0èÛÈ]šY\ˆBœ™\ÜÛœØXš[YYH[™HZHHš[È›ÈYZ[ÈÈœ˜[˜ÚÜšX]˜H[XšYİZYYB™H]Y[H™[™\š^˜HÈ]pêÈ[HÛÛ\Û™[H]]ØÛÛYÈÜˆ\È0êHXZ\ÂœÚ[\\ÈHÙ[H\ÜØH[XšYİZYYK‚‚ŠŠ‘Y\XØpéğèÛÈ™X[°èÛÈğìÈ™X[ØØpéğèÛÈHğìÙYÛÊŠˆ
ÛÜœ™péğèÛÈB›ÜÜ[šYYH[˜ÛÛ˜YH\˜[HH^˜péğèÛË°èÛÈYYH0è\JN‚˜[\UÚYÙ][İšYÈ˜HÚYÙ]\İ\ÜŞ
]š]H[\ÜÚ\˜İ[\‹š°èH]YHpî›\ÜÈÛÜœÜÈ^˜pëYÜÈ™XÚ\Ø[H[JNÈš[\Ú\8 %[\Â[XHÛÜİ\™HØØ[[HÚYÙ]Ø\™Ø\\˜[™Èš[\œØØÙ]š[\œØÂ™\ØÛÜË™XÜšXYH[\XÚ][Y[HHØYH™[™\ˆ8 %š\›İHÛÛ\Û™[B™^ÜYÈ[HÚYÙ]\İ\ÜŞ™XÙX™[™Èš[\œØØÙ]š[\œØ˜ÛÛ[È›ÜÈ^0ëXÚ]\Ë[[Z[˜HH™XÙ\ÜÚYYHH™XYX\ˆHÛÜİ\™B˜ÛÛ[È›Ü]˜]°ê\ÈHØYH\œ]Z]›È^˜pëYÎÈ›İ›È\ÈÚYÙ]˜YÔ›ÜØ™^ÜYÈ˜H\˜\ˆH™\]\ˆHY\ÛXH[špèÛÈHLˆ›ÜÈÜÚ[Û˜Z\È[B˜ÚYÙ]XYØ[\UÚYÙ]ØØYHÛÜœÈ^˜pëYË‚‚ŠŠ”›İ˜HH]YHÈÛÛ\Ü[Y[È°èÛÈ]YİJŠˆ
Ù[H\İH[š]0è\š[Âœ°êKY^\İ[H˜HÛÛ™šX\‹™\šYšXØpéğèÛÈ]™H]YHÙ\ˆXZ\È\ØYH]YHÂ››Ü›X[
NˆœØÈK[›Ñ[Z][\È\Ú\ÈHØYH^˜péğèÛÈ[™]šYX[ŠYÛÈÙYË[˜ØHXİ[][YÊNÈœ\Û[KYš^ÛÛ™š\›X[™È™\›È[\Ü›°èÛÈ][^˜YÈÛØœ˜[™È›ÜÈ\œ]Z]›ÜÈÜšYÚ[˜Z\È\Ú\ÈH™[[İ™\ˆØYB˜œ˜[˜ÚÈœH[ˆZ[ÛÛH[™HÛÛ™š\›XYÈÙ[H™YÜ™\ÜğèÛÈH[X[šÂŠœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÊNÈœ^]ÜšYÚ\İ
L‘B˜ÛÛ\]ÊH\›İ˜YÈÛÛ˜H]ˆÙ\™\ˆ™X[È
Š™\šYšXØpéğèÛÈX[X[›Â›˜]™YØYÜŠŠˆÈ\Ú›Ø\™H[[Ûœİ˜péğèÛÈ™X[
™[™\×ÌŒ‹ŞŒLˆ[š\ÊH8 %S’ÒS‘ÈÔˆS’QQX™[™\š^˜YÈÛÛHYÈÛÛ\]YÂ˜ÛÜœ™]È
[šHHÎLK[šHˆÎ‹[šHÈÎ
KÛ\]YK\˜KYš[˜\‚\İYÈ˜\ÈX\È\™péğíY\È
ÛXØ\ˆ˜H˜\œ˜HÈ˜[šÚ[™Èš[˜HL¸¡¤›[š\ÈH]X[^˜HÔ\ÎÈÛXØ\ˆ›ÈÚ\‘š[˜YÈÜˆ[šHHˆ™[[İ™HÂ™š[›ÈH›ÛHHL¸¡¤ŒLŠK™\›È\œ›È›İ›È›ÈÛÛœÛÛH
ğìÈ[H]š\ÛÈBšY˜]péğèÛÈ°êKY^\İ[HH°èÛÈ™[XÚ[Û˜YËÛØœ™HÈ^ÈÈ›İ0èÛÈB›[ÙÈš]˜YËØ]\ØYÈÜˆ\İYÈHÙ\ÜğèÛÈ[\š[Üˆ›ÈØØ[İÜ˜YÙJK‚‘\ÜØH™\šYšXØpéğèÛÈÛKXK\ÛH\˜H\ÜXÚX[Y[H[\Ü[H\]ZHÜœ]YB˜H^˜péğèÛÈÈš[\Ú\]YİHİXH\ÜÚ[˜]\˜H
HÛÜİ\™H[\0ëXÚ]Bœ˜H›ÜÈ^0ëXÚ]\ÊHH›ØÛİH[™QÜ›İ\ÛXÚØÜˆ[XHÚ[XYB™\™]HHÙÙÛPÛXÚÑš[\˜8 %]Y[°éØHYXğè›šXØKX\È^][Y[HÈ\Â™H™Y˜XİÜˆ]YH[H\İH]]ÛX]^˜YÈ°èÛÈÛØœšXHHğìÈ™\šYšXØpéğèÛÈ™X[œ›İ˜K‚‚ŠŠ”™\İ[YÈ0ë\]ZYÊŠˆÚYÙ]XØ\™ŞØZ]HHÍMÈ\˜HÍŒ[š\ÂŠMÎÈ[š\ËLŒ‰JKˆœš]\İ[˜
MMH\ÜÛİKH[YËÙ[B›]Y[°éØHHÛÛYÙ[H8 %™[š[H\İH›İ›È›ÚHYYÈ™\İH˜]XKX\Â›™[š[H\İH^\İ[H]YXœ›İJKœØÈK[›Ñ[Z]œ\Û[KYš^ŠÈ™]Y\ˆÔ“‹\ØY™H[HÙÜÈÜÈÈ\œ]Z]›ÜÈØØYÜËœH[ˆZ[B˜œH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÜË‚‚ŠŠ”[™0ê›˜ÚXH^0ëXÚ]K°èÛÈ[\[Y[YJŠˆ
°ìŞ[XH˜]XH˜]\˜[
NˆÜÂHœ˜[˜Ú\È™\İ[\È8 %^Ù\[Û‹\[™[
XZ[Üˆœ˜[˜Ú°èÛËYÜ°èYšXÛËŸŒÍÍˆ[š\Ë]]ØÛÛYÊKØÚY[KZX]X\
MÍÈ[š\Ë]]ØÛÛYÊK˜Y]šXØØY]šXË]™[™
[˜ÛZHÜ\šÛ[™H™XÚ\È[›[™JKHÈXZ[ÜˆBÙÜË˜\˜ØYXØ[™XØ\™XX
Î[š\ËÛÛ\\[B˜Xİ]™TYR[™^ØÙ[XİYYR[™^ØXİ]™P˜\’[™^ğìÈ[™HÚH8 %ÙBš\˜\ˆ[H0î›šXÛÈ\œ]Z]›È]]ØÛÛYÈ]˜[™È\ÜÙH\İYÈ[ÊKˆÜÂ˜œ˜[˜Ú\È°èH[YØYÜÈHÛÛ\Û™[\È^H
][™[˜ÙK[İ™\šY]Ø]Ëˆ8¡¤‚˜Ü\˜][Û˜[ÚYÙ]›ÙXX\8¡¤ˆX\ÚYÙ]›ÙX
HHÜÈœ˜[˜Ú\Âœ\]Y[›ÜÈ
›Û\‹Yš[\Ø[XYÙXŒMKM[š\ÊH°èÛÈ›Ü˜[HØØYÜÈÜ‚š°èH\İ\™[H›È[X[šÈÙ\ÈİH°èH^˜pëYÜËˆÈY°èÛÈ\İHÙpéğèÛÂŠÛÛ\Û™[H]]ØÛÛYÈÜˆ\ËÚ›ÛYHÛÛ\\[YÈ^˜pëYÈ˜B˜ÚYÙ]\İ\ÜŞ]X[™ÈÙ[Z[˜[Y[H\XØYË™\šYšXØpéğèÛÂ™[™]ËY[™›È˜]™YØYÜˆ[\ÈHÛÛœÚY\˜\ˆ›ÛÊH]™HÙH™\]\ˆ˜\Âœ°ìŞ[X\È˜]X\Ë‚‚“Y\ØÛYHÛÛ[ÈÔˆÌM—JÎ‹ËÙÚ]X‹˜ÛÛKÛÛ]™MÛÛ\]X[YYKÜ[ÌMŠB™\Ú\ÈHÙÜÈÜÈÚXÚÜÈHÒH\ÜØ\™[HH]]Üš^˜péğèÛÈ^0ëXÚ]HÂ\İpè\š[ËˆXZ[ˆ]˜[°éÛİHHLX˜ÍX\˜HÎMÎ‚‚ˆÈÈMKˆ]š\ğèÛÈHÚYÙ]XØ\™ŞÛÛ˜ÛpëYNˆÜÈHœ˜[˜Ú\È™\İ[\È^˜pëYÜË\œ]Z]›ÈØZHHÍMÈ\˜HÌÎ[š\È
MÎIJB‚•\İpè\š[ÈY]H˜H›ÜÜÙYİZ\ˆÛÛHÈ™\İ[HÈ˜XÚÛÙÈ][HˆÙYİZYÈÂ›Y\Û[ÈY°èÛÈHÙpéğèÛÈM
ÛÛ\Û™[H]]ØÛÛYÈÜˆ\ËÚ›ÛYB™Ù[Z[˜[Y[H\XØYÈ^˜pëYÈ˜H\œ]Z]›ÈÛÛ\\[YË™\šYšXØpéğèÛÂ˜ØØ
Ø\Û[
Øš]\İ
ØZ[
ÑL‘JÛ˜]™YØYÜˆ™X[HØYH^˜péğèÛÈ8 %Ù[B˜Xİ[][\ˆ]Y[°éØ\È°èÛÈ™\šYšXØY\ÊK‚‚ŠŠ‘^˜pëYÜË[HÜ™[HHÛÛ\^YYHÜ™\ØÙ[JŠ‚‚‹H^Ù\[Û‹\[™[]ÚYÙ]X›ÙKŞ
XZ[Üˆœ˜[˜Ú°èÛËYÜ°èYšXÛËLˆ[š\ÊH8 %ÜÈ\ÙTİ]XH™]š\ğèÛÈH^ÙpéğèÛÂˆ
^Ù\[Û•šY]ØØY][™Ñ^Ù\[Û˜ØÛÜœ™Xİ[Û•˜[YXØÛÜœ™Xİ[Û”™X\ÛÛ˜
BˆÛÛ™š\›XYÜÈ\ØYÜÈğìÈ[H
Ü™\[\ÈH[İ™\ŠHH[İšYÜÈ˜H[›ÂˆÈÛÛ\Û™[K°èÛÈXZ\È[HÚYÙ]Ø\™ˆXÚYÈ›ÈØ[Z[šÎˆÈ^ÜˆÔÕˆ\Ø]˜H;îïÉØÜİŸX
“ÓHšXH\ØØ\H[šXÛÙJH8 %ÈY]Ü‚ˆ\İHÙ\ÜğèÛÈ[œÚ\İXH[HÛÛ™\\ˆHÙ\]pê›˜ÚXH;îïØYÚ]YH[Bˆ]\È[HØ\˜Xİ\™H“ÓH]\˜[[ÈÜ˜]˜\ˆÈ\œ]Z]›È
Y\Û[È›Ø›[XBˆ™X\\™XÙ]H[H°è\šX\È[]]˜\ÈHY]ØÜš]X
NÈÛÛÜ›˜YÂˆ\ØÜ™]™[™È[HÚÙ[ˆH^ÈÛÛ][Hš[YZ\›È
›ÙHYXÛÛBˆİš[™Ë™œ›ÛPÚ\ÛÙX
HHğìÈ\Ú\ÈİXœİ]Z[™È[È^Âˆ;îïØ]\˜[8 %™\İ[YÈš[˜[ÛÛ™š\›XYÈ]HH]Bˆ
”ÓÓ‹œİš[™ÚYXÈ™XÚÊH[\ÈHÙYİZ\‹‚‹HØÚY[KZX]X\]ÚYÙ]X›ÙKŞ
N[š\ÊK‚‹HY]šXË]ÚYÙ]X›ÙKŞ
Y]šXØ
ÈY]šXË]™[™[˜ÛZHÜ\šÛ[™Bˆ™XÚ\ÊK‚‹HÚ\]ÚYÙ]X›ÙKŞ
˜\˜ØYXØ[™XØ\™XXÎ[š\È8 %ÂˆXZ[ÜˆHÙÜÊKˆÜÈÈ\ÙTİ]XH[\˜péğèÛÂˆ
Xİ]™TYR[™^ØÙ[XİYYR[™^ØXİ]™P˜\’[™^
HÛÛ™š\›XYÜÂˆ\ØYÜÈğìÈ[HH[İšYÜÈ˜H[›ÈÈÛÛ\Û™[K‚‚ŠŠ“›İ›ÈÛÚÈÛÛ\\[YËXÚYÈ\˜[HH^˜péğèÛÈÈY]šXË]™[™
Š‚›ÈÜ\šÛ[™HÈY]šXË]™[™\ØH^][Y[HHY\ÛXH0ìÙÚXØHH›ÛYÙ[BšÜš^›Û[Üˆ\œ˜\İÈ
Ú\ØÜ›Û™Y˜Ø[™PÚ\ØÜ›ÛÚ[\‘İÛ˜Â˜Ú\ØÜ›Û]ÛœØ
H]YHÈ›ØÛÈHÜ°èYšXÛÜÈš[˜Ú\[8 %^˜pëYÈ˜B˜\ÙKXÚ\ZÜš^›Û[\ØÜ›ÛŞ
™XÚ\ØHÙ\ˆŞ°èÛÈØÜ‚˜ÛÛ\ˆ”Ö›È›İ0èÛÈH›ÛYÙ[H8 %YÛÈ[ÈØØ˜Hš[YZ\˜H[]]˜JB™H\ØYÈ[ÈÜˆY]šXË]ÚYÙ]X›ÙKŞ]X[ÈÜ‚˜Ú\]ÚYÙ]X›ÙKŞ[0ê[HÈ]YHÛØœ›İH[HÚYÙ]Ø\™[\È\İB›0ìÙÚXØH[X°ê[HØZ\ˆH0èK‚‚ŠŠ•™\šYšXØpéğèÛÈHš\ØÛÈ›ÜÜ˜Ú[Û˜[[È[X[šÈH]Y[°éØJŠˆÛÛ[Â˜Ú\]ÚYÙ]X›ÙKŞ0êHÈœ˜[˜ÚXZ\ÈÛÛ\^È
[\˜péğèÛÈB˜Û\]YKÚİ™\ˆ[H˜\œ˜HH^˜KÜ›ÜÜËYš[\‹ÛÛ\ÊKH™\šYšXØpéğèÛÈ[B›˜]™YØYÜˆ™X[›ÚH[0ê[HÈÚXÚÈš\İX[8 %Û\]YH›ÙÜ˜[pè]XÛÈšXB˜\Ü]Ú]™[[HÙ]Üˆ™X[ÈÜ°èYšXÛÈH^˜HH[XH˜\œ˜H™X[Â™Ü°èYšXÛÈH˜\œ˜\È
Ø[İ[[™ÈHÜÚpéğèÛÈšXHÙ]›İ[™[™ĞÛY[™Xİ

X›°èÛÈğìÈÚ[X[™ÈÈ[™\ˆ™XXİ\™][Y[JKÛÛ™š\›X[™È[H[X›ÜÈÜÂ˜Ø\ÛÜÎˆÛÛYÙ[HH[š\Èš\ğë]™Z\È]YHÛÜœ™][Y[H
L¸¡¤
KÚ\ˆ‘š[˜YÈÜˆˆ\\™XÙK™[[İ™\ˆÈÚ\›ÛHHL¸¡¤ŒL‹™\›È\œ›È›İ›Â››ÈÛÛœÛÛKˆ\ÜØH0êHHY\ÛXH™\šYšXØpéğèÛÈHX\È\™péğíY\È°èH\ØYH˜BœÙpéğèÛÈM\˜H˜[šÚ[™ØYÛÜ˜H\İ[™YH›ÈØ[Z[šÈH[\˜péğèÛÈXZ\Â˜ÛÛ\^ÈÈ\œ]Z]›È[Z\›Ë‚‚˜œš]\İ[˜
MMH\ÜÛİKH[YÈ8 %Ù[H\İH›İ›È™\İH˜]XKX\Â›˜YH]YXœ›İJKœØÈK[›Ñ[Z][\È\Ú\ÈHØYH^˜péğèÛÂš[™]šYX[œ\Û[KYš^Ù[H\œ›È™X[™\İ[H
ğìÈ]š\ÛÜÂœ°êKY^\İ[\ÈH˜\İ\™Yœ™\Ú[HÚYÙ]\İ\ÜŞ
KœH[ˆZ[ŠÈœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÜËœ^]ÜšYÚ\İ
L‘B˜ÛÛ\]ÊH\›İ˜YÈÛÛ˜H]ˆÙ\™\ˆ™X[\Ú\ÈH˜]XH[Z\˜K‚‚ŠŠ”™\İ[YÈ0ë\]ZYÊŠˆÚYÙ]XØ\™Ş›ÚHHÍMÈ[š\ËÌMLHĞ‚Š[°ëXÚ[ÈHÙpéğèÛÈM
H\˜H
ŠÌÎ[š\ÊŠˆ8 %™YpéğèÛÈHÎIH›È\œ]Z]›Âš[Z\›È[ÈÛ™ÛÈ\ÈX\ÈÙpéğíY\ËˆÙÜÈÜÈM\ÜÈHÚYÙ]ÜšYÚ[˜Z\Â˜YÛÜ˜Hš]™[H[H\œ]Z]›È°ìÜš[È

‹]ÚYÙ]X›ÙKŞ
HİH°èH[YØ]˜[B˜[\È˜HÛÛ\Û™[H^H
Ü\˜][Û˜[ÚYÙ]›ÙXX\ÚYÙ]›ÙX
NÂ˜ÚYÙ]Ø\™šXÛİH™Y^šYÈH[H\Ü]Ú\ˆÜˆË\X
ÈÚ›ÛYB˜ÛÛ\\[YÈ
˜YÔ›ÜØÚ^™PÛÛ›ÛØ
H
ÈÜÈÚ\Èœ˜[˜Ú\È\]Y[›ÜÂœ]YH[˜ØH™XÚ\Ø\˜[HH^˜péğèÛÈ
›Û\‹Yš[\Ø[XYÙXŒMKM›[š\ÈØYJKˆ][HÈ˜XÚÛÙÈ™XÚYÈ8 %°èÛÈ0èHXZ\È[™0ê›˜ÚXHB™]š\ğèÛÈ™YÚ\İ˜YK‚‚“Y\ØÛYHÛÛ[ÈÔˆÌM×JÎ‹ËÙÚ]X‹˜ÛÛKÛÛ]™MÛÛ\]X[YYKÜ[ÌMÊB™\Ú\ÈHÙÜÈÜÈÚXÚÜÈHÒH\ÜØ\™[HH]]Üš^˜péğèÛÈ^0ëXÚ]HÂ\İpè\š[ËˆXZ[ˆ]˜[°éÛİHHÎMÎ\˜HLLÙ‚‚ˆÈÈM‹ˆÛÛ™šX[°éØHÜˆÛÛ[˜H˜H™]š\ğèÛÈH[\ÜpéğèÛÈ
˜YÙH[KÛpêYXKØ˜Z^H
È[İ]›ÊB‚•\İpè\š[È›İ^H[XH\İH^[œØHHš[ÜšYY\È
”š[ÜšYYH[H8 %™˜^™\ˆYÛÜ˜HŠHÛØœš[™ÈÛÛ™šXXš[YYHH[\ÜpéğèÛËVH\œ›ËœÙYİ\˜[°éØHH[™œ˜Y\İ]\˜HH›Ù]ËØ\œ]Z]]\˜Kˆ\™İ[YÈÜˆÛ™B˜ÛÛYpéØ\È\ØÛÛYHHÛXpéğèÛÈHÛÛ™šX[°éØHÜˆX˜KØÛÛ[˜H8 %š[YZ\›Âš][HHÙpéğèÛÈHXZ[Üˆš[ÜšYYHH[XÙ\˜ÙHÜÈİ]›ÜÈ][œÈHY\ÛXBœÙpéğèÛÈ
[ÙÈH™]š\ğèÛÈH™[]0ìÜš[ÈHšY[YYH\[™[HH\ˆ[BœÚ[˜[HÛÛ™šX[°éØH˜H[Üİ˜\ŠK‚‚ŠŠ’[™\İYØpéğèÛÈ°ê]šXH
İX˜YÙ[H^Ü™JH[\ÈH\Ù[š\ˆ]X[]Y\‚˜ÛÚ\ØJŠˆH[™œ˜Y\İ]\˜HHÛÛ™šX[°éØH°èH^\İXH[HÜ˜[™H\H8 %˜Z[ÚY]ÛÛ™šY[˜ÙSX]š^
°ë]™[ÜˆX˜K[KÛpêYXKØ˜Z^H
È[İ]›ÜÊBš°èH^\İHH°èH0êH™[™\š^˜YÈÛÛ[ÈÛÛ\˜\ÈX˜\ÈH™]š\ğèÛÎÂ˜ÛÛ[[‘XYÛ›ÜİXØ
ÜˆÛÛ[˜JH°èH[šHÛÛ™šY[˜ÙX
Ù\^˜HB™]XğéğèÛÈH\ËLJHHØ\›š[™ÜÎˆİš[™Ö×XÛÛ\]YÜËX\È
Š›[˜ØBœ™[™\š^˜YÜÈ[HYØ\ˆ™[š[JŠˆ8 %ÈØ\™X[°èÛÈ\˜H˜Ø[İ[\ˆÛÛ™šX[°éØBœÜˆÛÛ[˜H‹\˜H™˜[]˜HÈ°ë]™[HÈØ]YÛÜšX\ÈHHRH˜H[Üİ˜\ˆÂœ]YH°èH^\İXH‹ˆ[\Ü]Y]
Y\ØÛYÙ[œÈ^[™Y\Ë°ìÜ›][\Âœ™Xİ\\˜Y\Ë[š\È[Hœ˜[˜ÛÈYÛ›Ü˜Y\È]ËŠH[X°ê[H°èH0êHÛÛ\]YÈX\Â›[˜ØHÚYØH0è[H8 %X\XYÈÛÛ[ÈØ\™X[°èÛÈÛÜœšYÚYÈ™\İHÙpéğèÛÂŠšYHœ[™0ê›˜ÚXHˆX˜Z^ÊK‚‚ŠŠ’[\[Y[YÊŠˆÛÛ™šY[˜ÙS]™[›ÜŠØÛÜ™JNˆ˜[HŸ›pêYXHŸ˜˜Z^H˜™^˜pëYÈÛÛ[È[°éğèÛÈ\˜H[H[\ÜZ[[YÙ[˜ÙKØ
Y\Û[ÜÈ[ZX\™\ÂKÍŒ]YHZ[ÚY]ÛÛ™šY[˜ÙSX]š^°èH\Ø]˜KYÛÜ˜H›ÛYXYÜÈBœ™X\›İ™Z]YÜË°èÛÈXZ\È\XØYÜÊKˆ›İ›È\ÈÛÛ™šY[˜ÙS]™[˜ÛÛ\\[YÎÈÚY]ÛÛ™šY[˜ÙS]™[\ÜØHHÙ\‚˜ÛÛ™šY[˜ÙS]™[œÙ[HXYÛ°ìÜİXÛÈ˜ˆÛÛ[[‘XYÛ›ÜİXØØ[šİHÈØ[\Â˜]™[ÛÛ\]YÈÛÛ[ÈHpêYXHHÛÛ™šY[˜ÙJŒLH]X[]TØÛÜ™XŠ\ÈX\Èpê]šXØ\ÈYY[HÛÚ\Ø\ÈY™\™[\È8 %È]pèÛÈ™[HÈY°èÛÈ˜]HœË‚›È]pèÛÈ[šY›Ü›YH0êHÈ™Y[˜ÚYÈ8 %HğìÈÛÜœ™\ÜÛ™[HH˜[Hˆ]X[™È\Â™X\ÈÛÛ˜ÛÜ™[JKÛÛH[XH™YÜ˜HYXÚ[Û˜[ˆ]X[]Y\ˆØ\›š[™ÜË›[™İˆš[\YH˜[H˜Y\Û[È]YHÈØÛÜ™HÛÛXš[˜YÈÜ^™HÈ[ZX\ˆ8 %°èÛÈ˜^‚œÙ[YÈ[Üİ˜\ˆ˜[HÛÛ™šX[°éØHˆ[ÈYÈH[H[İ]›ÈH0îšYH\İYÂ›˜HY\ÛXHÛÛ[˜K‚‚“›İ›ÈÛÛ\Û™[HÛÛ\\[YÈÛÛ™šY[˜ÙKYİŞ
ÛÛ™šY[˜ÙQİ
H8 %œÛÈÛÛÜšYÈ[Y\˜[Ø[X™\‹Ü›ÜÙKY\Û[ÈX\X[Y[ÈHÛÜˆ]YH°èH\˜B\ØYÈ[›[™H˜\ÈX˜\ÈH™]š\ğèÛÎÈ™Y˜]Ü˜YÈ\˜H™X\›İ™Z]\ˆ[H™^ˆB™\XØ\‹ˆ™[™\š^˜YÈÜˆÛÛ[˜H[H[\Ü]ÛÜšØ™[˜ÚŞ›ÈØX™péØ[Â˜ÛXğè]™[H˜[˜ØYHH[\ÜpéğèÛÈˆ
Y\Û[È›İ0èÛÈ]YH°èH[\›˜Bš[˜ÛZ\‹ÚYÛ›Ü˜\ˆÛÛ[˜JKÛÛH]X[Üİ˜[™Â˜ÛÛ™šX[°éØH	Û]™[H8 %	İØ\›š[™ÜËš›Ú[ŠÈŠ_X8 %Y\Û[ÈY°èÛÈBÛÛ\°èH\ØYÈ[\ÈX˜\Ë‚‚•\İ\È›İ›ÜÈ[H[\ÜZ[[YÙ[˜ÙK\İØˆ[ZX\™\ÈB˜ÛÛ™šY[˜ÙS]™[›Ü˜ÈÛÛ[˜H[\HHÛÛœÚ\İ[H8¡¤ˆ[NÈÛÛ[˜HÛÛB˜]š\ÛÈ^0ëXÚ]È[˜ØH[Üİ˜H[HY\Û[ÈÛÛHØÛÜ™HÛÛXš[˜YÈ[È
›İ˜B™\™]HH™YÜ˜HH[[ğéğèÛÊNÈÛÛ[˜HÛÛH™\™\Ù[péğíY\ÈZ\İ\˜Y\ÈB›]Z]H]\ğê›˜ÚXH8¡¤ˆ˜Z^H
š^\™HZ\İYH\Ú\ÈH[XHš[YZ\˜H[]]˜B˜ÛÛHğìÈH˜[Üˆ™Y[˜ÚYÈ°èÛÈÙ\˜\ˆ[˜ÛÛœÚ\İ0ê›˜ÚXHİYšXÚY[H8 %ÛÜœšYÚYÂ\Ø[™Èpî›\ÜÈ˜[Ü™\ÈH˜[pë[XHH™\™\Ù[péğèÛÈY™\™[K[˜ÛZ[™Â™\œ›ÜÈH°ìÜ›][HÈ^Ù[[\ÈHXÙZ]\ˆÈ\İJK‚‚ŠŠ•™\šYšXØpéğèÛÈ[0ê[HH\İ\È[š]0è\š[ÜÊŠˆÛÛ[ÈÙ[\™H™\İHÙ\ÜğèÛÈ\˜B›]Y[°éØ\ÈHRK™\šYšXØYÈ[H˜]™YØYÜˆ™X[8 %\ØYH[HÔÕ‚œÚ[0ê]XÛÈÛÛH[XHÛÛ[˜H[\HHX\ÈÛÛ[˜\ÈÛÛH	HH˜[Ü™\Â˜]\Ù[\ÈÛÛ™š\›[İH^][Y[HÈÛÛ\Ü[Y[È\Ü\˜YÎ‚˜›Ù]È8¡¤ˆÛÛ™šX[°éØH[H˜
ÛÈ™\™JK˜[Ü˜ØÛÛY[\š[Ø8¡¤‚˜ÛÛ™šX[°éØHpêYXH8 %]Z]ÜÈ˜[Ü™\È]\Ù[\È˜
ÛÈ0è›X˜\ŠKˆXÚYÈ›Â˜Ø[Z[šÎˆÈ›^ÈH[[Ûœİ˜péğèÛÈ
™\ˆ[[Ûœİ˜péğèÛØ
H°èÛÈ\ÜØH[Âœ\[[™H™X[HXYÛ°ìÜİXÛÈ
™\\™J
X[H›İ]\ËÚ[™^Ş[š™]B˜›İÖ×X›ÛÜÈÙ[HÚ[X\ˆXYÛ›ÜÙR[\ÜYÚY]
K[0èÛÈ°èÛÈÙ\š]Bœ˜H™\šYšXØ\ˆ8 %™XÚ\ÛİHH\ØY™X[
šXHÚ[][péğèÛÈB˜[œ]™š[\ØÙ]™[ÈÚ[™ÙX]YH[˜Ú[Û›İH[X›Ü˜HÈ™]Ü››Èğë[˜Ü›Û›Âš[YYX]ÈÈØÜš\[šH[Üİ˜YÈ[˜ÛÜœ™][Y[HŒ\œ]Z]›ÜÈˆ8 %Â\ØY›ØÙ\ÜÛİHH™\™YH[H[œİ[H\Ú\ÊK‚‚•[X°ê[H›YÜ˜YÈ
°èÛÈÛÜœšYÚYËÜ]Û—İ\ÚØ™YÚ\İ˜YÈ›È\İpè\š[Â™XÚY\ŠNˆ[H\œ›È™X[H™\›Ù^°ë]™[HÛÜœšYHHY˜]péğèÛÈÔÔ‚Š’Y˜][Ûˆ˜Z[Y‹‹ˆ[ÙÈš]˜YÈŠH\\™XÙ]H[HÙH™\šYšXØpéğèÛÈB›˜]™YØYÜˆ\İHÙ\ÜğèÛÈ[Z\˜K[˜ÛZ[™È\È[\š[Ü™\È8 %›Ü˜HB™\ØÛÜÈ\İHÙpéğèÛËX\ÈÛÛ™š\›XYÈÛÛ[ÈYÈ™X[°èÛÈpëYË‚‚˜œš]\İ[˜
MNH\ÜÛİKH[YÈ8 %\İ\È›İ›ÜÊKœØÂ‹K[›Ñ[Z]œ\Û[KYš^›ÜÈÈ\œ]Z]›ÜÈØØYÜÈ
È™]Y\‚Ô“‹\ØY™KœH[ˆZ[
ÈœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØB˜œ^]ÜšYÚ\İ
L‘HÛÛ\]ÊH\›İ˜YÜË‚‚ŠŠ”[™0ê›˜ÚXH^0ëXÚ]K°èÛÈ[\[Y[YJŠˆ[\Ü]Y]
Y\ØÛYÙ[œÂ™^[™Y\Ë°ìÜ›][\È™Xİ\\˜Y\Ë[š\ÈYÛ›Ü˜Y\È]ËŠHÛÛ[XB˜ÛÛ\]YÈH[˜ØH™[™\š^˜YÈ8 %°ìŞ[[È\ÜÛÈ˜]\˜[˜H›[Üİ˜[™Â™^][Y[HÈ[İ]›ÈˆH°ë]™[HX˜KÛÛ\[Y[[™ÈÈ°ë]™[HÛÛ[˜Bš[\[Y[YÈ\]ZKˆÈ™\İ[HH\İH˜^šYH[È\İpè\š[È
[ÙÈBœ™]š\ğèÛÈ°êKZ[\ÜpéğèÛË™YÜ˜\ÈH[\ÜpéğèÛÈØ[˜\ÈÜˆ[Ù[Ëœ™[]0ìÜš[ÈHšY[YYHÜˆX˜KY[YšXØpéğèÛÈH\œ]Z]›ÈÜˆÛÛpî™Ë›[Z]HH0è\™XH[™›YK˜]H[Z]\İšXpëYËĞTÕ˜HÒK]ËŠBœ\›X[™XÙH™YÚ\İ˜YÈÛÛ[È°ìŞ[X\Èš[ÜšYY\Ë°èÛÈX˜[™Û˜YË‚‚ˆÈÈMËˆÛÜœšYÚYÈÈYÈ™X[HY˜]péğèÛÈÔÔˆÚ[˜[^˜YÈ˜HÙpéğèÛÈMˆ
’Y˜][Ûˆ˜Z[Y‹‹ˆ[ÙÈš]˜YÈŠB‚•\İpè\š[È\ØÛÛ]H[™\İYØ\ˆ\İHXÚYÈ
›YÜ˜YÈÛÛ[ÈÜ]Û—İ\ÚØ˜BœÙ\ÜğèÛÈ[\š[Ü‹ÙpéğèÛÈMŠH[H™^ˆHÙYİZ\ˆH\İHHš[ÜšYY\Ë‚‚ŠŠØ]\ØH˜Z^ŠŠˆÛÛœİÜš]˜]S[ÙKÙ]š]˜]S[ÙTİ]WHH\ÙTİ]J

BOˆ\Ôš]˜]S[ÙJ
JX[H›İ]\ËÚ[™^ŞÚ[X]˜H\Ôš]˜]S[ÙJ
XŠİÜ˜YÙKØ0êˆØØ[İÜ˜YÙK™Ù]][J’UPÖWÓSÑWÒÑVJX
H\™]È›Âš[šXÚX[^˜YÜˆÈ\İYË^Xİ]YÈ[È›ÈÙ\šYÜˆ]X[È˜Hš[YZ\˜Bœ™[™\š^˜péğèÛÈÈÛY[Kˆ›ÈÙ\šYÜˆØØ[İÜ˜YÙX°èÛÈ^\İK[0èÛÈÂœ™\İ[YÈ0êHÙ[\™H˜[ÙXÈ›ÈÛY[KÙHÈ\İpè\š[È°èH[šH]]˜YÈÂ›[ÙÈš]˜YÈ[XHÙ\ÜğèÛÈ[\š[Üˆ
\œÚ\İYÈ[HØØ[İÜ˜YÙX°èÛÈ0êB™Y°ê›Y\›ÊKÈ™\İ[YÈ0êHYX8 %ÜÈÚ\ÈS]™\™Ù[H›È^ÈÈ›İ0èÛÂŠ]]˜\ˆ[ÙÈš]˜YÈˆœËˆ“[ÙÈš]˜YÈYØYÈŠKHÈ™XXİ[°éØB˜Y˜][Ûˆ˜Z[YH›Ü›XHÛÛœÚ\İ[KÙ[\™H]YHÈ›YÈ°èH\İ]˜BœÙ]YË‚‚ŠŠÛÜœ™péğèÛÊŠˆY\Û[ÈY°èÛÈ°èH\ØYÈ\˜HY˜]Y
™\ˆÙpéğèÛÈÍÍÍJH8 %™\İYÈ[šXÚX[š^È[H˜[ÙX
YİX[[ÈÙ\šYÜŠKÚ[˜Ü›Ûš^˜YÈÛÛHÂ˜[Üˆ™X[H\Ôš]˜]S[ÙJ
XšXH\ÙQY™™Xİ


HO‚œÙ]š]˜]S[ÙTİ]J\Ôš]˜]S[ÙJ
JK×JX]YHğìÈ›ÙH›ÈÛY[H\0ìÜÂ˜H[ÛYÙ[K]X[™ÈÈ™XXİ°èH™XÛÛ˜Ú[[İHH0è\›Ü™HY˜]YK‚‚ŠŠ•™\šYšXØpéğèÛÈ[H˜]™YØYÜˆ™X[
Šˆ
°èÛÈğìÈ[š]0è\šXKÜˆÙ\ˆYÈB”ÔÔ‹ÚY˜]péğèÛÊNˆØØ[İÜ˜YÙKœÙ]][J›ÛX[K\š]˜]K[[ÙH‹ŒHŠX[\Â™ÈØ\œ™YØ[Y[Ë\Ú\È™XØ\™ØH[\KˆÙ[HHÛÜœ™péğèÛË™\›Ù^šYÈB™›Ü›XHÛÛœÚ\İ[H
Y˜][Ûˆ˜Z[Y™XØ]\ÙHHÙ\™\ˆ™[™\™Y^‹‹‹]]˜\ˆ[ÙÈš]˜YØ
NÈÛÛHHÛÜœ™péğèÛËÈ™XØ\™Ø\ÈÛÛœÙXİ]]˜\ÈÙ[B›™[š[H\œ›ËHÈ›İ0èÛÈ[Üİ˜HÛÜœ™][Y[H“[ÙÈš]˜YÈYØYÈˆ\Ú\Â™HY˜]péğèÛÈ
Y™Z]ÈØœÙ\˜YË°èÛÈğìÈ]\ğê›˜ÚXHH\œ›ÊKˆXÚYÂ›]\˜[™YÚ\İ˜YÈX\È°èÛÈÛÜœšYÚYÈ™\İHÙpéğèÛÈ
›Ü˜HÈ\ØÛÜÈÂœÚ[ÛXH™[]YËY\ÛXHÛ\ÜÙHHYÊNˆÚYX˜\˜[H›İ]\ËÚ[™^Ş[X°ê[H\ØH\ÙTİ]J

HOˆ\[ÙˆÚ[™İÈOOH[™Yš[™YˆÈYH‚Ú[™İË›X]ÚYYXJ‹‹ŠK›X]Ú\ÊX]YHÙH]™\™Ú\ˆÈY\Û[È™Z]Â™\[™[™ÈH\™İ\˜HHšY]ÜÜ8 %°èÛÈ™\›Ù^šYÈ™[HÛÛ™š\›XYÈÛÛ[ÂœÚ[ÛXH™X[ğìÈÚ[˜[^˜YÈÜˆÙ[Y[[°éØH\İ]\˜[‚‚˜œš]\İ[˜
MNH\ÜÛİKH[YËÙ[H\İH›İ›È8 %0êH[HYÈB[Z[™ÈHY˜]péğèÛË°èÛÈH0ìÙÚXØH\˜KH°èH0èH™\šYšXØpéğèÛÈB›˜]™YØYÜˆ™X[ÛØœš[™ÈÈÙ[°è\š[ÊKœØÈK[›Ñ[Z]œH[ˆZ[˜œ^]ÜšYÚ\İ
L‘HÛÛ\]ÊH\›İ˜YÜË‚‚ˆÈÈNˆ™[]0ìÜš[ÈHšY[YYHÜˆX˜H˜H™]š\ğèÛÈH[\ÜpéğèÛÈ
][H[™[HHÙpéğèÛÈM‹˜XÚÛÙÈ][HJB‚”°ìŞ[[È][H˜]\˜[Hœ™[H˜ÛÛ™šXXš[YYHH[\ÜpéğèÛÈ‹°èBœ™YÚ\İ˜YÈÛÛ[È[™0ê›˜ÚXH^0ëXÚ]H˜HÙpéğèÛÈMˆ[\Ü]Y]ŠY\ØÛYÙ[œÈ^[™Y\Ë°ìÜ›][\È™Xİ\\˜Y\Ë[š\È[Hœ˜[˜ÛËÛØİ[\ËÂ™š[˜Z\ÈYÛ›Ü˜Y\ËÛÛ[˜\ÈYÛ›Ü˜Y\ËÛÛ™\œğíY\È[pê\šXØ\ËØX™péØ[ÜÂœ™\]YÜÈYÛ›Ü˜YÜË™YÚpíY\ÈX[Y\È[\ÊH°èH\˜HÛÛ\]YÈÜ‚˜ÚY]Ô›İÜØ
[\ÜØ
HHÚYØ]˜H]0êH™]šY]ÔÚY]Ø[B˜›İ]\ËÚ[™^ŞX\ÈğìÈ\˜HÛÛœİ[ZYÈ[\›˜[Y[HÜ‚˜™\ÛÛ™TÛİ\˜ÙPÙ[š[Ø8 %[˜ØHÚYØ]˜H0èRH™[HÛØœ™]š]šXH[0ê[HBœ™]š\ğèÛÈ
°èÛÈ[˜H[HÚY]]XÜˆXÚ\ğèÛÈH\ØÛÜÈ°èH[\0ëXÚ]N‚°êH[H™[]0ìÜš[ÈH[\ÜpéğèÛË°èÛÈ[HYÈÈZ[™[
K‚‚ŠŠ’[\[Y[YÊŠˆ]Y]šY[]T\˜Ù[
]Y]
Nˆ[X™\˜
[\ÜØ™[°éğèÛÈ\˜JH8 %\˜Ù[X[Hğê[[\È°èÛÈ˜^šX\ÈHÜšYÙ[H]YBœÛØœ™]š]™\˜[H]0êHHX™[H[\ÜYH
İ]]›Û‘[\PÙ[ØÛØœ™B˜Ûİ\˜ÙS›Û‘[\PÙ[Ø\œ™YÛ™YË[˜ØH\ÜØHHLY\Û[ÈÙH[XB™°ìÜ›][H™Xİ\\˜YHš^™\ˆÈİ]]İ\\˜\ˆHÜšYÙ[JKˆ™X\›İ™Z]B˜ÛÛ™šY[˜ÙS]™[›Ü˜
[ZX\™\ÈKÍŒ°èH\ØYÜÈ[HÙpéğèÛÈMŠH›Â˜ÛÛ™šY[˜ÙQİÈZ[™[Y\Û[ÈX\X[Y[ÈHÛÜˆ[HÙHH™]š\ğèÛË‚‚”Z[™[]Z[Ï˜›İ›È[H™]šY]ËŞY\Û[ÈY°èÛÈš\İX[ÜÈİ]›ÜÂš[™[0è\š[ÜÈH™]š\ğèÛÈ
\\›[šÜË›ÛY\ÈYš[šYÜËÛÜˆBœ™Y[˜Ú[Y[È]ËŠNˆ˜YÙHÛÛH\˜Ù[X[
ÈÛÈHÛÛ™šX[°éØH›Âœ™\İ[[ËH[›È[XH\İHH°ìİ[ø¡¤˜[Üˆ˜HØYHØ[\ÈÂ˜[\Ü]Y]ÛÛ™XÚ[Û˜YHHˆ˜H°èÛÈÛZ\ˆ[XH[\ÜpéğèÛÈ[\B˜ÛÛH™\›ÜÈ
ğìÈ˜ğê[[\È˜HÜšYÙ[H‹È˜ğê[[\È˜HX™[H[\ÜYHˆÙ[\™B˜\\™XÙ[KÈ™\İÈ0êHÛÛ™XÚ[Û˜[
K‚‚ŠŠ•™\šYšXØpéğèÛÈ[H˜]™YØYÜˆ™X[
Šˆ
°èÛÈğìÈ[š]0è\šXKÜˆ[›Û™\ˆ\ØY™H\[[™HHXYÛ°ìÜİXÛÈ™X[8 %Y\ÛXH™\ÜØ[˜HHÙpéğèÛÈMˆ•™\‚™[[Ûœİ˜péğèÛÈˆ°èÛÈ\ÜØHÜˆXYÛ›ÜÙR[\ÜYÚY]ØÚY]Ô›İÜØB™\™YJNˆÔÕˆÚ[0ê]XÛÈÛÛH[XH[šH[Hœ˜[˜ÛÈ›ÈYZ[ÈH[XHÛÛ[˜B›[pê\šXØHØ[˜HÛÛ[È^È
‰L]ËŠHšXHÚ[][péğèÛÈB˜[œ]™š[\ØÙ]™[ÈÚ[™ÙXˆZ[™[[Üİ›İH^][Y[HLˆğê[[\È˜B›ÜšYÙ[H
ØX™péØ[È
ÈHğê[[\ÈHYÊKH˜HX™[H[\ÜYH
ØX™péØ[Â›°èÛÈÛÛHÛÛ[Èğê[[HHYÈ›Èİ]]
KÈÛÛ™\œğíY\È[pê\šXØ\ËB›[šH[Hœ˜[˜ÛÈYÛ›Ü˜YH8 %ÍIHHšY[YYK\š]pê]XØHÛÛ™™\šYH0è›pèÛÈ[\ÈHXÙZ]\ˆÈ™\İ[YË‚‚\İ\È›İ›ÜÈ[H[\Ü\İØ
]Y]šY[]T\˜Ù[
NˆšY[YYBİ[\™H\˜ÚX[\œ™YÛ™YK[˜ØH[˜\\ÜØHL	HY\Û[ÈÛÛHİ]]›XZ[Üˆ]YHHÜšYÙ[KL	H]X[™È°èÛÈ0èHğê[[HHÜšYÙ[HH™\Ù\˜\‹‚‚˜œš]\İ[˜
MŒÈ\ÜÛİKH[YÈ8 %\İ\È›İ›ÜÊKœØÂ‹K[›Ñ[Z]œ\Û[›ÜÈÈ\œ]Z]›ÜÈØØYÜÈ
ğìÈpëYÈHÔ“‚œ°êKY^\İ[KÛÛ™š\›XYÈÛÛHÈÛÛÜ››È™]Y\ˆÔ“‹\ØY™JKœH[‚˜Z[
ÈœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØœ^]ÜšYÚ\İ
L‘B˜ÛÛ\]ÊH\›İ˜YÜË‚‚ˆÈÈNKˆÛÛ™š\›XpéğèÛÈHØX™péØ[ËÚ[\˜[Ëİ\ÜÈØœšYØ]0ìÜšXH[\ÈHÙ\˜\ˆÈ™[]0ìÜš[È
˜XÚÛÙÈ][HK›[ÙÈH™]š\ğèÛÈ°êKZ[\ÜpéğèÛÈXZ\ÈİZXYÈŠB‚”°ìŞ[[È][HH\İHHš[ÜšYY\ÈÈ\İpè\š[Ëˆ
Š’[™\İYØpéğèÛÈ°ê]šXBŠİX˜YÙ[H^Ü™JH[\ÈH\Ù[š\ˆ]X[]Y\ˆÛÚ\ØJŠˆÙHBš[™œ˜Y\İ]\˜HH]XğéğèÛËØZ\İH°èH^\İXH8 %ØX™péØ[È]XİYÈB›[Üİ˜YÈ
™]šY]ËŞ
K[\˜[ÈY]0è]™[
[\Ü]ÛÜšØ™[˜ÚŞ˜Ø[\ÜÈ”š[YZ\˜H[šH‹È°æ›[XH[šHŠK\ÜÈÜˆÛÛ[˜HÙ[\™Bš\ğë]™Z\ÈHY]0è]™Z\È
X™[HÛÛ[˜HÈ\ÈH›Ü›X]ÈÈ[[Üİ˜HŠKˆÈØ\œ™X[°èÛÈ\˜H˜[HH™Xİ\œÛË\˜HHÛÛ™š\›XpéğèÛÈÙ\ˆ
Š›ÜÚ[Û˜[B˜ÛÛ™XÚ[Û˜[
Šˆ™YYĞÛÛ™š\›X][Û˜ğìÈ]]˜]˜HÛÛHÛÛ™šX[°éØH˜Z^BŠÛÛ™šY[˜ÙHÌXY\‹˜ÛÛ™šY[˜ÙHØİHpî›\\È™YÚpíY\ÊNÂ›[XH[\ÜpéğèÛÈ››Ü›X[ˆÈ\İpè\š[ÈÙXHÛXØ\ˆ\™]È[H‘Ù\˜\‚œ™[]0ìÜš[ÈˆÙ[H[˜ØHÛ\ˆØX™péØ[Ë[\˜[ÈİH\ÜËˆ[ÜˆÙB˜Xœš\ÜÙHH˜[˜ØYHH[\ÜpéğèÛËY]\ÜÙH”š[YZ\˜H[šH‹È°æ›[XB›[šHˆX\È\Ü]YXÙ\ÜÙHHÛXØ\ˆ\XØ\ˆÙ[péğèÛÈ‹H[\˜péğèÛÈ\˜B™\ØØ\YH[HÚ[0ê›˜Ú[È8 %È›İ0èÛÈš[˜[°èÛÈ\[™HH\J
X\‚œ›ÙYËğìÈ0êˆXİ]™Kœ›İÜØØXİ]™K˜ÛÛ[[œØÈ\İYÈÈÚY]‚‚ŠŠ‘XÚ\ğèÛÈH›Ù]È^0ëXÚ]JŠˆÛÛ[È\ÜÛÈ]YHÈÛÛ\Ü[Y[ÈHÙBš[\ÜpéğèÛÈ
°èÛÈ0êHYË0êHV›İ˜JK\™İ[YÈ[È\İpè\š[ÈÈ›Ü›X]È[\Â™H[\[Y[\ˆ8 %ÈÜ0éğíY\È\™\Ù[Y\È
HÚXÚØ›ŞÙ[\™Hš\ğë]™[Â˜ÚXÚÜÈÜ˜[[\™\Ë™\İ[[ÈÙ[H›Ü]YZ[ÊKˆ\ØÛÛYÎˆ
ŠŒÈÚXÚÜÂ™Ü˜[[\™\ÊŠ‹‚‚ŠŠ’[\[Y[YÊŠˆÈÚXÚØ›Ş0î›šXÛÈÙ[°ê\šXÛÈ
ÛÛ™š\›X\ˆZ]\˜B˜[X°ëYİXH‹ğìÈ\\™XÚXHÛÛHÛÛ™šX[°éØH˜Z^JH›ÚHİXœİ]pëYÈÜˆÂ˜ÚXÚØ›Ş\ÈÙ[\™Hš\ğë]™Z\ÈH[™\[™[\È8 %ØX™péØ[Ë[\˜[ÈB›[š\Ë\ÜÈ\ÈÛÛ[˜\È8 %ØYH[HÛÛHÈ˜[Üˆ]X[[Èš]›È
[šHÂ˜ØX™péØ[È
ÈÛÛ™šX[°éØNÈÙ[Xİ[Û‹œİ\›İØ8 $ØÙ[Xİ[Û‹™[™›İØB˜›İÜË›[™İÈÛÛYÙ[HHÛÛ[˜\ÊHH\Û[™ÈÛ™HÛÜœšYÚ\ˆ˜H˜[˜ØYB™H[\ÜpéğèÛÈX˜Z^Ëˆ]X[™È™YYĞÛÛ™š\›X][Û˜Z[™H0êHYX
Y\Û[ÜÂ›[ZX\™\ÈH[\ÊKÈØ\™ÈØX™péØ[ÈØ[šH\İ\]YH0è›X˜\ˆH[H]š\ÛÂ™^˜H8 %H\İ[°éğèÛÈHÛÛ™šX[°éØH˜Z^H°èÛÈ›ÚH\™YKğìÈZ^İHHÙ\‚›È0î›šXÛÈØ]Kˆ\ØX›Y^ÈZXY\ÚXÚÙY\˜[™ÙPÚXÚÙYˆ]\\ĞÚXÚÙYX›È›İ0èÛÈ‘Ù\˜\ˆ™[]0ìÜš[ÈÈ\İYÈ™\Ù]H[È›ØØ\ˆB˜X˜H
\ÙQY™™Xİ[H˜Xİ]™R[™^Y\Û[ÈY°èÛÈ\Èİ]˜\Âœ™Z[šXÚX[^˜péğíY\ÈÜˆX˜H™\İH[JK‚‚ŠŠ•™\šYšXØpéğèÛÈ[H˜]™YØYÜˆ™X[
ŠˆÛÛH\ØYHÔÕˆÚ[0ê]XÛÎˆ›İ0èÛÂ™\ØXš[]YÈÛÛHÌÈX\˜ØYÜËÛÛ[XH\ØXš[]YÈÛÛH‹ÌÈ
\İYÂšXH\İYÈ™X[ÜÈÚXÚØ›Ş\Ë°èÛÈğìÈZ]\˜Hš\İX[
KXš[]HğìÈÛÛB›ÜÈÈX\˜ØYÜËHÈÛ\]YH[H‘Ù\˜\ˆ™[]0ìÜš[Èˆ]˜[°éØH›Ü›X[Y[H]0êHÂœZ[™[
ÛK”]X[YYKZ[™[
KÙ[H\œ›ÈHÛÛœÛÛK‚‚ŠŠ‘Y™Z]ÈÛÛ]\˜[[˜ÛÛ˜YÈHÛÜœšYÚYÊŠˆÈ\İHL‘H^\İ[BŠ[[ËY\Ú›Ø\™œÜXËØ
HÛXØ]˜H\™]È[H‘Ù\˜\ˆ™[]0ìÜš[Èˆ\Ú\ÈÂ™›^È•™\ˆ[[Ûœİ˜péğèÛÈˆ8 %]YH[X°ê[H\ÜØH[H™]š\ğèÛÈ™X[°èÛÈğìÂœ[È][ÈHXYÛ°ìÜİXÛËˆZ\İYÈ\˜HX\˜Ø\ˆÜÈÈÚXÚØ›Ş\ÂŠÙ]T›ÛJ˜ÚXÚØ›Ş‹È˜[YNˆ‹‹ˆJXÜˆ›ÛYHXÙ\Üğë]™[HØYB›X™[
H[\ÈÈÛ\]YK‚‚˜œš]\İ[˜
MŒÈ\ÜÛİKH[YÈ8 %™[š[H\İH›İ›ÈH0ìÙÚXØBœ\˜K0êH[HØ]HHRHÛØ™\ÈÜˆL‘H™X[
KœØÈK[›Ñ[Z]œ™\Û[›ÜÈˆ\œ]Z]›ÜÈØØYÜÈ
™]Y\ˆ™Y›Ü›X]İH™]šY]ËŞB™\™YH™\İHÙpéğèÛÈ8 %°èÛÈ\˜HğìÈpëYÈHÔ“ˆ\İH™^‹K]Üš]X˜\XØYÈH™XÛÛ™™\šYÊKœH[ˆZ[
ÈœH[‚œ\™›Ü›X[˜ÙN˜ÚXÚØœ^]ÜšYÚ\İ
L‘HÛÛ\]Ë[˜ÛZ[™ÈÂ˜Z\İHXÚ[XJH\›İ˜YÜË‚‚ˆÈÈLˆ\İpè\š[È›İ^HLˆ[š[\È™XZ\ÈHØ[Xœ˜péğèÛËÜ]X[YYNˆÛÜœ\ÈÓHØZHHÍH˜HËÍKÚ\ÈYÜÈ™XZ\ÈH›Ü›X]péğèÛÈ[˜ÛÛ˜YÜÈHÛÜœšYÚYÜË[H\˜ÙZ\›È™YÚ\İ˜YÂ‚”YYÈÈ\İpè\š[Îˆ[H\Ø\ˆ\ÜØ\È[š[\È˜H›Ü[XÙ\ˆÈÛÜœ\È‹˜[™^[™ÈLˆ\œ]Z]›ÜÈ™XZ\ÈÈÚ[™İÜÈİÛ›ØYÈ
ˆŞÈØÂ˜ÛX
KˆÛÛ^È[YYX]ÎˆHÙ\ÜğèÛÈ[šHXØX˜YÈH™]š\Ø\ˆHˆÌMÂŠÛÜœ\È
™\š]˜YÊ‹]YH[X™\˜Y[Y[H°èÛÈÛÛH›ÈØ]H˜]]›È8 %™\ˆØÜËÕĞTÓWĞÓÔ”T×ÔĞS’UVUSÓ‹›Y
K[0èÛÈ\İH\˜HHš[YZ\˜H]˜B™H\œ]Z]›È™X[\ÙH[0èÛÈš\Ø[™ÈÈØ]H˜]]›ÈH™\™YK‚‚ŠŠ”™\\›ÊŠˆÜÈLˆ\œ]Z]›ÜÈÛÜXYÜÈšXHİÙ\”Ú[
°èÛÈ˜\ÚÜÜ‚˜Ø]\ØHHXÙ[ÜÈ›ÜÈ›ÛY\ÈÜšYÚ[˜Z\ÊH˜H\İYš^\™\ËÜš]˜]KÂ™İÛ›ØYËX˜]ÚÛÛH›ÛY\ÈTĞÒRHÚ[\\ËÚ]YÛ›Ü˜YËˆÜÈÈØŠ›Ü›X]Èš[°è\š[ÈÓLˆ[YÛÊH›Ü˜[HYÛ›Ü˜YÜÈ]]ÛX]XØ[Y[H[ÂœØ[š]^˜YÜˆ8 %›Ü˜HÈ\ØÛÜÈÓÖSÈ™XY[™È[™Ú[™HŒ‹°èÛÈ0êHXİ[˜B››İ˜KˆÛÜœ\ÎœØ[š]^™X›ØÙ\ÜÛİHÜÈH™\İ[\È
ˆŞ
ÈÈÛX
B˜ÛÛHØ[Ù\˜YÈØØ[Y[H
Ü\Ëœ˜[™ÛP]\Ø[˜ØHÛÛ[Z]YÊK‚‚ŠŠXÚYÈH8 %˜[ÛÈÜÚ]]›È›È˜[YYÜŠŠˆ
ÛÜœšYÚYË‚–ÈÌMWJÎ‹ËÙÚ]X‹˜ÛÛKÛÛ]™MÛÛ\]X[YYKÜ[ÌMJJN‚˜ÛÜœ\Î˜[Y]X
YXÚ[Û˜YÈ˜HˆÌMÊH™\›İ›İHˆÜÈH\œ]Z]›ÜÈÛÛBˆ››ÛYHYš[šYÈÈ\İpè\š[ÈÛØœ™]š]™]H‹ˆ[™\İYØpéğèÛÎˆ°èÛÈ0êH˜^˜[Y[ÈBœš]˜XÚYYH8 %ÈØ[š]^˜YÜˆÙ[\™H™\˜HÛÜšØ›ÛÚË“˜[Y\ØÂ˜Ş›K—Ñš[\‘]X˜\ÙX0êH™XÛÛœİpëYÈ[È°ìÜš[ÈÚY]”ÈH\\ˆÂ˜X]]Ùš[\˜HX˜KÙ[H›ÛYHH\İpè\š[È™[š[KˆÈYÈ\˜HH™YÙ^Â˜[YYÜˆ^YÚ\ˆ\Ü\ÈÚ[\\È[È™YÜˆÈ›ÛYHHX˜BŠ	ÔÒQUÌIÈK‹‹˜
KX\ÈÈÚY]”ÈğìÈÚ]H]X[™ÈÈY[YšXØYÜˆ^YÙBŠ\ÜpéÛÜËØ\˜Xİ\™\È\ÜXÚXZ\ÊH8 %ÒQUÓ““˜[˜ØH^YÙKØZHÙ[B˜\Ü\Ëˆ[˜ØH[šHÚYÈ^\˜Ú]YÈÛÛH[H\œ]Z]›È™X[ÛÛH]]Ùš[›Â˜[\Ëˆ™YÙ^ÛÜœšYÚYH˜H\Ü\ÈÜÚ[Û˜Z\ÎÈ\İHH™YÜ™\ÜğèÛÈ[B˜ÛÜœ\Ë]ÛÛË\İØ™\›Ù^ˆÈÙ[°è\š[È^]È
X˜HÛÛHX]]Ùš[\˜
K‚‘\Ú\ÈHÛÜœ™péğèÛÎˆÛÜœ\Î˜[Y]X\›İ›İHÜÈH\œ]Z]›ÜËŒ‹LÂ˜ğê[[\Ë\šYYH\İ]\˜[Hš]˜XÚYYHÛÛ™š\›XY\Ë‚‚ŠŠ“Y\ØÛYÈ›ÈÛÜœ\È™X[
ŠˆÜÈH\œ]Z]›ÜÈ˜[YYÜÈ›Ü˜[H™[[Y\˜YÜÂŠØ[š]^™YLØHØ[š]^™YLMXÛÛ[X[™ÈHÙ\]pê›˜ÚXHÜÈ‚˜Ş°èH^\İ[\ÊHHY\ØÛYÜÈ[H\İYš^\™\ËÜØ[š]^™Y\™X[Â›X[šY™\İ›ØØ[šœÛÛ˜ˆ\İšXZpéğèÛÈš[˜[ˆLˆŞ
Ø]H°èH™XÚYÂ™\ÙH[\Ë‹ÍJK
ŠŒÈÛX™XZ\ÈH\İ[ÜÈ8 %Ø]HØZHHÍH˜BŒËÍJŠ‹Z[™H[œİYšXÚY[H›ÜÈHpë[š[[ÜÈX\È›ÙÜ™\ÜÛÈ™X[[Bœš[YZ\˜H™^ˆ™\ÜÙH›Ü›X]Ë‚‚ŠŠXÚYÈˆ8 %YÈ™X[H\šYYH\İÕ\TØÜš\Ú\È\İ0èYÚ[ÜÊŠ‚ŠÛÜœšYÚYË‚–ÈÌMLJÎ‹ËÙÚ]X‹˜ÛÛKÛÛ]™MÛÛ\]X[YYKÜ[ÌML
JN‚˜œH[ˆØ\ÛN˜ÛÜœ\ØÛÛ˜HÈÛÜœ\È[\XYÈ[Üİ›İHˆÜÈH\œ]Z]›ÜÂ››İ›ÜÈ]™\™Ú[™È[™HÈZ]Üˆ\İÕĞTÓHHÈ\TØÜš\8 %™[š[B˜\œ]Z]›ÈÈÛÜœ\È[YÛÈ]™\™ÚXK[0èÛÈ\˜HØ\˜[Y[Y[H[HÚ[ÛXB››İ›Ë°èÛÈpëYÈ°êKY^\İ[Kˆ\ÛÛYÈÛÛH[HØÜš\HXYÈYZØÂŠ×ÙXYËY]™\™ÙK›ZœØ[\Ü°è\š[Ë°èÛÈÛÛ[Z]YÊH]YHÛÛ\\˜Hğê[[HB˜ğê[[HÜÈÚ\È[İÜ™\ÈH[\š[YHğìÈ\ÈY™\™[°éØ\Ë‚‚‹H
‘\İ0èYÚ[ÈJˆ\Ü^WØÙ[İ˜[YX
\İ
HğìÈ™XÛÛšXÚXHğìÙYÛÜÈBˆ›Ü›X]Èš^È
Œ˜ŒŒ˜Œ	H˜ŒŒ	H˜
H8 %]X[]Y\ˆİ]˜BˆÛÛYÙ[HHXÚ[XZ\Èš^ÜÈ
ŒŒ˜ŒŒ˜]Ë‹ÛÛ][œÈ[Bˆ[š[\ÈHØ[Xœ˜péğèÛËÛYYpéğèÛÊHØpëXH[H›Ü›X]ÙÙ[™\˜[Û[X™\˜ˆ
‘Ù[™\˜[‹ÛÜH™\›ÜÈ0è\™Z]JH[H™^ˆHÛÛ\]\ˆ\ÈØ\Ø\ÂˆXÚ[XZ\ÈÈ›Ü›X]ËˆÈ˜[Üˆœ]È
˜]Õ˜[YX
HÙ[\™H›ÚHY0ê›XÛÂˆ›ÜÈÚ\È[İÜ™\È8 %ğìÈHİš[™ÈH^XšpéğèÛÈ]™\™ÚXH
^ˆNH˜ˆ[H™^ˆHNKŒ˜
Kˆš^YÙXÚ[X[ÜXÙ\ØÙ[™\˜[^˜H˜Bˆ]X[]Y\ˆ]X[YYHH™\›ÜÈ\Ú\ÈÈÛËX[[™ÈÜÈØ\ÛÜÂˆ[YÛÜÈ[XİÜË‚‹H
‘\İ0èYÚ[ÈŠˆ
XÚYÈğìÈ\Ú\ÈH™]™\šYšXØ\ˆÈÛÜœ\È™X[ÛÛHÂˆ\İ0èYÚ[ÈH°èHÛÜœšYÚYÈ8 %Z[™HÛØœ˜]˜[H]™\™ğê›˜ÚX\ÈY[›Ü™\ÊNˆY\Û[ÂˆÛÛHÈ›Ü›X]ÈÙ\ÈY[YšXØYË›Ü›X]Jİ˜[YN‹™XÚ[X[ßHŠXˆ\™]È›È^]È]™\™ÙHÈ^Ù[ÔÚY]”È\ÈÈYZ[ÈÂˆ0î›[[È0ëYÚ]Ëˆ^[\È™X[ˆMMKX0êH\›X^™[˜YÈÛÛ[ÂˆMMKNNNNNNNMLÍÌÎÌLØ[H
pëYÈš[°è\š[È[™]š]0è]™[°èÛÈ0êBˆYÈH\œÚ[™ÊH8 %›Ü›X]\ˆ\ÜÙH˜[Üˆ^]ÈÛÛHHXÚ[X[\œ™YÛ™Bˆ˜H˜Z^È
MMK›İ[™Z[‹]ËY]™[ˆÈQQQHÍMÛØœ™HÈš[°è\š[Âˆ™\™YZ\›ÊKX\ÈMMKH
ˆLHMMMXØZH^]È[H
Ù[BˆpëYÊKH\œ™YÛ™\ˆ\ÜÙH˜[Üˆ\ØØ[YÈ˜HÚ[XH[\ÈH\Ù\ØØ[\‚ˆ˜]HÛÛHÈ]YHÈ^Ù[HÈÚY]”È[Üİ˜[H
MMKX
K‚ˆ›Ü›X]Ùš^YÙXÚ[X[Ø™\XØHÈ[ÛÜš][ÈH\ØØ[x¡¤˜\œ™YÛ™x¡¤‚ˆ\Ù\ØØ[HÈ^Ù[ÔÚY]”È[H™^ˆH›Ü›X]\ˆÈ˜[Üˆ^]È\™]Ë‚‚ŠŠ”™XZ[™X[ÈØ\ÛX°èÛÈğìÈÈğìÙYÛÈ\İ
ŠˆÛÛ[Â˜Ø\™ÛÈZ[ØØ\ÛK\XÚØ°èÛÈ[˜Ú[Û˜[H™\İHØ[™›ŞÚ[™İÜÈ
™\‚˜\›XY[HÍÈ[™Ù™ŠKØYH[XH\ÈX\ÈÛÜœ™péğíY\È™XÚ\ÛİHB˜ÚÛÜšÙ›İÈ[ˆØ\ÛKXZ[[[K\™Yˆœ˜[˜Ú˜
Z[™X[›ÈX[K˜Ø\™ÛÈ\İH™\™YH8 %MH\İ\È[š]0è\š[ÜË[˜ÛZ[™ÈÜÈ›İ›ÜÈ\İBœÙpéğèÛÊHÙYİZYÈHÚ[ˆİÛ›ØYÈ\Y˜]ÈHİXœİ]ZpéğèÛÈX[X[™HÜ˜ËİØ\ÛKÛÛK[ÛŞ[XÛÜ™KÛÛWÛÛŞ[ØÛÜ™WØ™ËØ\ÛXˆÙ[H\ÜÙH\ÜÛËÜÂ\İ\È”È
Ø\ÛK\ÚYİËXÛÜœ\Ë\İØ
HÛÛ[X\šX[H›Ù[™ÈÛÛ˜HÂ˜š[°è\š[È[YÛÈH™[š[XHÛÜœ™péğèÛÈ\šXHY™Z]ÈØœÙ\°è]™[›Ü˜HÜÂ\İ\È[š]0è\š[ÜÈ\İ\ÛÛYÜË‚‚ŠŠ”™\İ[YÈš[˜[™\šYšXØYÈÛÛ˜HÈÛÜœ\È™X[
Šˆ
°èÛÈğìÈ\İ\Â[š]0è\š[ÜÈÚ[0ê]XÛÜÊNˆŞØZ]HHÈ˜HH\œ]Z]›È]™\™Ù[H
LM8¡¤ˆÌ‚˜ğê[[\ÊNÈÛHÙ[H]Y[°éØH
ˆğê[[\È8 %Ø]\ØH˜Z^ˆY™\™[K™\‚˜XÚYÈÊKˆœH[ˆØ\ÛN˜ÛÜœ\Øœš]\İ[˜
Mˆ\ÜÛİKBœ[YÊKœØÈK[›Ñ[Z]œH[ˆZ[œ^]ÜšYÚ\İ˜\›İ˜YÜÈÛÛHÈš[°è\š[È™XÛÛœİpëYË‚‚ŠŠXÚYÈÈ8 %YÈ™X[H›Ü›X]ÈH]Hİ\İÛZ^˜YË°àÓÈÛÜœšYÚYÂ›™\İHÙ\ÜğèÛÊŠˆ
™YÚ\İ˜YÈ›È\İpè\š[ÈXÚY\ˆš[ÜšYYJNˆ\Â™]™\™ğê›˜ÚX\È™\İ[\È
ÈHŞ]YHÛØœ›İH
ÈÜÈÈÛX[Z\›ÜÊBœğèÛÈÙ\ÈHY\ÛXHØ]\ØH˜Z^‹Y™\™[HH[\š[Üˆ8 %ğìÙYÛÈH›Ü›X]Â™H
Š™]JŠˆİ\İÛZ^˜YÈHğê[[H
[KŞ^X[[K^^XÛ[KŞ^X]ËŠBœÙ[™ÈYÛ›Ü˜YÈ[È\İ]YHÙ[\™H[Üİ˜HTÓÈPPPKSSKQÙ[°ê\šXÛÂš[™\[™[HÈ›Ü›X]È™X[Hğê[[H
^ˆğê[[H›Ü›X]YH[[K^^X˜ÛÛH˜[Üˆ™X[ŒÌ‹LKLMX]™\šXH[Üİ˜\ˆ’˜[‹LÌˆ˜\İ[Üİ˜B˜ŒŒÌ‹LKLMH˜
KˆY\Û[ÈY°èÛÈÈXÚYÈˆ
˜[Üˆœ]ÈY0ê›XÛËğìÂ™^XšpéğèÛÈ]™\™ÙJKX\È\ØÛÜÈ™[HXZ[Üˆ8 %H0ìÙÚXØHH]HÈ\İŠ^Ù[Ù]KœœØ
HğìÈÛØœ™HÜÈ›Ü›X]ÜÈH]H
˜Z[[ŠˆÈ^Ù[
QÂŒMLŒ‹ÍKMÈ[HZ[[—Û[X™\—Ù›Ü›X]
K°èÛÈ›Ü›X]ÜÈH]BŠ˜İ\İÛZ^˜YÜÊˆ\˜š]°è\š[ÜÈ™YÚ\İ˜YÜÈ[Hİ[\Ë[]YHğèÛÈÛÛ][œÂ™[H[š[\È™XZ\ÈHÜ›Û›ÙÜ˜[XKØØ[Xœ˜péğèÛËˆ°èÛÈ[™\İYØYÈH[™Â›™[HÛÜœšYÚYÈ8 %XØX›İHHÙ\ˆ\ØÛØ™\È[Èš[˜[\İHÙ\ÜğèÛË0êHÛ\˜[Y[B[HYÈXZ[Üˆ]YHÜÈÚ\È°èHÛÜœšYÚYÜÈ\]ZKY\™XÙHÙ\ÜğèÛÈ°ìÜšXK‚‚˜œš]\İ[˜œØÈK[›Ñ[Z]œH[ˆZ[œ^]ÜšYÚ\İ\›İ˜YÜÈ[HÙ\È\È]\\È[\›YYpè\šX\ÈH›È\İYÈš[˜[‚‚ˆÈÈLKˆ\œÙ\ˆÙ[°ê\šXÛÈH›Ü›X]ÈH]H›ÈZ]Üˆ\İ
XÚYÈÈHÙpéğèÛÈL˜XÚÛÙÈ][HØŠB‚•\İpè\š[ÈY]H^XÚ][Y[H˜HÛÜœšYÚ\ˆÈXÚYÈÈ™YÚ\İ˜YÈ˜BœÙpéğèÛÈ[\š[Ü‹\Ú\ÈH\™İ[\ˆÜˆ]YH°èÛÈ[šHÚYÈÛÜœšYÚYÂš[È8 %™\ÜÜİNˆ\ØÛÜÈ™[HXZ[Üˆ]YHÜÈÚ\ÈYÜÈHXÚ[X[ŠÙ[™\˜[^˜\ˆ[XH™YÜ˜HÚ[\\ÈœËˆ\ØÜ™]™\ˆ[H\œÙ\ˆH™\™YJKœš\ØÛÈH[›Ù^š\ˆ[HYÈ›İ›ÈÙH™Z]È0èÈ™\ÜØ\È›Èš[HH[XBœÙ\ÜğèÛÈ°èHÛ™ØKˆ\İpè\š[ÈÛÛ˜ÛÜ™İH[H›ÜÜÙYİZ\ˆ[XH]\HÙ\\˜YK™\Ú\ÈHY\ØÛ\ˆ\ÈX\ÈœÈ[™[\Èš[YZ\›Ë‚‚ŠŠØ]\ØH˜Z^ŠŠˆ›Ü›X]Ù^Ù[Ù]X
^Ù[Ù]KœœØ
H\˜H[HX]ÚœÛØœ™HŒMHİš[™ÜÈH›Ü›X]ÈH]H^]\ÈHš^\È
›KÙŞ^H˜˜›[[K^^H˜]ËŠH8 %]X[]Y\ˆğìÙYÛÈ›Ü˜H\ÜØH\İHØpëXH[H˜[˜XÚÂ’TÓÈÙ[°ê\šXÛËY\Û[È]X[™È]šXH[HØ\ÛÈ˜ÛÜ™Hˆ\]Z]˜[[H°èBœİ\ÜYËˆ›Ü›X]ÜÈ™XZ\È\È[š[\ÈÈ\İpè\š[È]YH^[š[HÈYÎ‚˜›[KŞ^H˜
™[H\İ]˜H˜HX™[JK™ÛKŞ^H˜
Ù[H™Y[˜Ú[Y[ÈB™\›ÊKHÛØœ™]YÈ›Ü›X]ÜÈÛÛH™Yš^ÈHØØ[YYKØÛÜˆÈ^Ù[ÛÛ[Â˜–ÉMM—[[[W^^NĞ˜8 %È™Yš^ÈÉMM—XHHÙpéğèÛÈH^ÈĞš[\YX[HÈX]Ú^]ÈY\Û[ÈÛÛH›[[K^^H˜Ù[˜[°èH™\Ù[H˜BX™[K‚‚ŠŠ’[\[Y[YÊŠˆ[H\œÙ\ˆH™\™YK°èÛÈXZ\È[˜Y\È˜HX™[B™š^H
]YHğìÈ[\\œ˜\šXHÈY\Û[È›Ø›[XH›È°ìŞ[[È›Ü›X]ÈB›ØØ[YYH°èÛÈ™]š\İÊN‚‹Hš\œİÙ›Ü›X]ÜÙXİ[Û˜ÛÜH˜Hš[YZ\˜HÙpéğèÛÈÈğìÙYÛÂˆ
ÜÜÚ]]›ÎÛ™YØ]]›ÎŞ™\›Îİ^Ø
KYÛ›Ü˜[™ÈØ[›ÈBˆ\Ü\ËØÛÛÚ]\Ë‚‹HÚÙ[š^™WÙ]WÙ›Ü›X]Ù\\˜HÈğìÙYÛÈ[HÚÙ[œÈHKÛKÙÚÜÂˆ
ÛÛ[™È™\]péğèÛÈH]˜K^ˆ›[Hˆ8¡¤ˆŠHH]\˜Z\È
\Ü\Ë\ØØ\BˆÙ\\˜YÜ™\ÊNÈ\ØØ\HÜ\ÜÈË‹‹—X[Z\›ÜÈ
ØØ[YYKØÛÜ‹ÂˆÛÛ™péğèÛÊHHÖØ
–
\ÜpéØ[Y[Èš\İX[È^Ù[Ù[HY™Z]Âˆ^X[
K‚‹H™\ÛÛ™WÛ[ÛÛZ[]X™\ÛÛ™HH[XšYİZYYHÛ0è\ÜÚXØH›HˆpêœË]œËBˆZ[]È[HY\ÛXH™YÜ˜HÈ^Ù[ˆ0êHZ[]ÈğìÈ]X[™ÈÈÚÙ[‚ˆÚYÛšYšXØ]]›ÈXZ\È°ìŞ[[È[\È0êHÜ˜KİHÈXZ\È°ìŞ[[È\Ú\È0êBˆÙYİ[™ÎÈÙ[°èÛÈ0êHpêœË‚‹H™[™\—Ù]WİÚÙ[˜™[™\š^˜HØYHÚÙ[ˆ[›È‹Í0ëYÚ]ÜËpêœÂˆ°î›Y\›ËŞ™\›Ë\YYØXœ™]šXYËÛ›ÛYHÛÛ\]ËXHY[H
È›ÛYHÈXHBˆÙ[X[˜HšXH[ÛÜš][ÈHØZØ[[İÈ
^WÛÙ—İÙYZØ[™\[™[HÂˆÙ\šX[^Ù[
KÜ˜HL‹ÌÛÛ™›Ü›YH™\Ù[°éØHH[KÜK[KÜHİ\Âˆ
H‹È”ŠHœËˆÛ™ÛÈ
SH‹È”HŠK‚‚HX™[Hš^HÜšYÚ[˜[ÛÛ[XH[XİHÛÛHš[ÜšYYH8 %È\œÙ\‚™Ù[°ê\šXÛÈğìÈ›ÙH›È˜[˜XÚËÙ[Hš\ØÛÈH™YÜ™\ÜğèÛÈ›ÜÈ›Ü›X]ÜÈ°èB\İYÜË‚‚ŠŠ•™\šYšXØpéğèÛÈÙ[HÛÛ\[péğèÛÈØØ[
ŠˆÈØ[™›Ş\İHÙ\ÜğèÛÈ°èÛÈ[šØB›™[HØ\™ÛÈÚXÚØ
˜[H›ÜÈZ[ØÜš\È\È\[™0ê›˜ÚX\È[\ÈB˜[Ø[°éØ\ˆÈÜ˜]H8 %°èÛÈ0êH\œ›ÈÈğìÙYÛÈ›İ›Ë\İYÈ\ÛÛY[Y[N‚™˜[HY0ê›XØH›Ù[™ÈØ\™ÛÈÚXÚØ[HÜ˜]H˜^š[ÊKˆ[\ÈB˜ÛÛ[Z]\‹™]š\ğèÛÈX[X[ÛÛ\]H˜péØ[™È0èpèÛÈØYH[HÜÈˆ\İ\Â››İ›ÜÈÛÛ˜HH[\[Y[péğèÛÈ
ÚÙ[œÈÙ\˜YÜË™\ÛÛpéğèÛÈpêœËÛZ[]Ëœ™[™\ˆš[˜[
H8 %ğìÈ\Ú\È\ÜÛÈÈğìÙYÛÈ›ÚHÛÛ[Z]YÈH[šXYÈ˜BÒKˆØ\™ÛÈ›]KXÚXÚØ\›İ˜YÈØØ[Y[K‚‚ŠŠ”™\İ[YÈ™X[šXHÚÛÜšÙ›İÈ[ˆØ\ÛKXZ[[[
Šˆ
X[KZ[ŠÈØ\™ÛÈ\İH™\™YJNˆŒH\İ\È[š]0è\š[ÜÈ\ÜØ[™È
MH8¡¤ˆŒKÜÈ‚››İ›ÜÈ\İHÙpéğèÛÊK˜[\È8 %ÛÛ™š\›XH]YHH™]š\ğèÛÈX[X[˜]]B˜Ù\ÈÛÛHÈÛÛ\[YÜˆH™\™YKˆš[°è\š[ÈØ\ÛX™XÛÛœİpëYÈBœ™]™\šYšXØYÈÛÛ˜HÈÛÜœ\È™X[ˆ
Š™\›È]™\™ğê›˜ÚXH[HŞ
Šˆ
L‚™›Û\È™XZ\ËØ]HKÍH™XÚYË[YÚX›NˆYX[Hš[YZ\˜H™^ŠHBŠŠ™\›È]™\™ğê›˜ÚXH[HÛJŠˆ
È›Û\È™XZ\ËZ[™HËÍHğìÈÜˆ›Û[YK›°èÛÈXZ\ÈÜˆ]X[YYHHZ]\˜JKˆÜÈ\œ]Z]›ÜÈ]YH]™\™ÚX[H˜BœÙpéğèÛÈL
ÈŞ™\İ[H
ÈÜÈÈÛX
H›Ü˜[HÙÜÈÛÜœšYÚYÜË‚‚ŠŠ‘[YÚXš[YYH0êXÛšXØH°èÛÈ0êH›Û[ğéğèÛÊŠˆ[YÚX›NˆYX›ÈØ]HÖ°êH[XHpê]šXØHØ[İ[YK°èÛÈ[XHpéğèÛÈ8 %°èÛÈ›Û[İ™HÈ\İÕĞTÓH˜B›Z]Üˆš[pè\š[È›Ü˜HHÚYİÈ[ÙHÛŞš[šËˆ\ÜÛÈÛÛ[XHÙ[™Â™XÚ\ğèÛÈH›Ù]ÈÈ\İpè\š[Ë™YÚ\İ˜YHÛÛ[È[™0ê›˜ÚXH^0ëXÚ]BŠ°èÛÈÛXYH™\İHÙ\ÜğèÛÊK‚‚˜œH[ˆØ\ÛN˜ÛÜœ\Øœš]\İ[˜
MÈ\ÜÛİKH[YÊKœØÈK[›Ñ[Z]œH[ˆZ[œ^]ÜšYÚ\İ
L‘JH\›İ˜YÜÂ˜ÛÛHÈš[°è\š[È™XÛÛœİpëYË‚‚ˆÈÈL‹ˆİ›
Ô^ÜHÈZ[™[ÛÛ[Èˆ[H™^ˆH[\š[Z\‚‚”YYÈ\™]ÈÈ\İpè\š[Îˆ˜YXÚ[Û™Hİ›
Ô›È›Ú™]Ë˜H\ˆÛÛ[Âš[\š[Z\ˆ‹ˆÈ\°èH[šH^ÜpéğèÛÈHˆÛÛ\]H
^Ü˜[B˜\ÙKY\Ú›Ø\™Y^ÜØYÚ[˜YKÛÛH\ÜÚ[˜]\˜HÛT]X[YYKX™[\ÈÛÛ\]\È[H™^ˆHğìÈÈ]YH\İ0èHš\ğë]™[˜H[JHšXHY[Bˆ‘^Ü\ˆˆ8 %Èpè[ÙÛÈH[\™\ÜğèÛÈ˜]]›ÈÈ˜]™YØYÜˆÙ\šXB™\İš][Y[H[Üˆ™\ÜÙHØ\ÛÈ
[\š[YHğìÈÈšY]ÜÜ]X[™[™\š^˜YËœÙ[HYÚ[˜péğèÛÈ™X[™[HÜÈYÜÈÛÛ\]ÜÈHX™[H][YJK‚‚ŠŠ’[\[Y[YÊŠˆ^Ü”™Y˜
Y\Û[ÈY°èÛÈ°èH\ØYÈÜ‚˜[™Ô™Y˜Ø™YÔ™Y˜[H›İ]\ËÚ[™^Ş
HX[0ê[HH™\œğèÛÈXZ\È™XÙ[B™H^Ü˜XÙ\Üğë]™[[›ÈÈ\İ[™\ˆHÙ^YİÛ˜ÛÛH\Â˜^šX\È
\ÙQY™™Xİ


HOˆÈ^Ü”™Y‹˜İ\œ™[H

HOˆ›ÚY™^ÜŠ
NÈJXÙ[H\œ˜^HH\[™0ê›˜ÚX\Ë›ÙHHØYH™[™\ŠK‚İ›
Ôø£&[\˜Ù\HÈ][È˜]]›ÈÈ˜]™YØYÜˆ
Kœ™]™[Y˜][

X
B™HÚ[XH^Ü”™Y‹˜İ\œ™[

XˆYXÚ[Û˜YÈ[Èpè[ÙÛÈH][ÜÂŠİ›
ËÊH˜HšXØ\ˆ\ØÛØœ°ë]™[‚‚ŠŠ•™\šYšXØpéğèÛÈ[H˜]™YØYÜˆ™X[[˜ÛZ[™È[H[\›YH˜[ÛÂš[™\İYØYÊŠˆİ›
Ô\Ü\˜YÈšXH\Ü]Ú]™[[Üİ›İHÈY[Bˆ‘^Ü\ˆˆ™\ÛÈ[H‘Ù\˜[™È¸ )ˆˆÜˆXZ\ÈHÌÙYİ[™ÜÈ8 %\™XÚXH[B˜YÈ›İ›Ëˆ\ÛÛYÈÛXØ[™ÈÈ][HHY[H”ˆÈZ[™[ˆÜšYÚ[˜[Š°êKY^\İ[KÙ[H™[š[XH[šHØØYH™\İHÙ\ÜğèÛÊHÈY\Û[È™Z]Î‚›Y\Û[È˜]˜[Y[ÈY0ê›XÛËˆÛÛ™š\›XH]YH0êH[HÛÛ\Ü[Y[È°êKY^\İ[B™H[˜Ø[˜\Ë\›Ø
›İ˜]™[Y[H[ÈİH™\ÛÈØ\\˜[™È\İBœZ[™[H[[Ûœİ˜péğèÛÈ\ÜXÚYšXØ[Y[H›È˜]™YØYÜˆ]]ÛX]^˜YÈ\İBœÙ\ÜğèÛË°èÛÈ™\›Ù^šYÈ™[H[™\İYØYÈH[™ÈÜˆ\İ\ˆ›Ü˜HÂ™\ØÛÜÈÈYYÊH8 %°èÛÈ[XH™YÜ™\ÜğèÛÈ\İH]Y[°éØKˆØİ[Y[™›ÛÂ‹œ™XYX
İ\ÜZ]È[šXÚX[
H™\ÛÛ™H›Ü›X[Y[K[0èÛÈ°èÛÈ0êHHØ]\ØK‚İ›
ÒÈ
[]HHÛÛX[™ÜÊHHİ›
ËÈ
][ÜÊH\İYÜÈ\Ú\Ë™[˜Ú[Û˜[™È›Ü›X[Y[H8 %Ù[H™YÜ™\ÜğèÛÈ›ÜÈİ]›ÜÈ][ÜÈÈY\Û[Â›\İ[™\‹‚‚˜œš]\İ[˜
MÈ\ÜÛİKH[YÊKœØÈK[›Ñ[Z]œ™\Û[›ÜÈˆ\œ]Z]›ÜÈØØYÜÈ
ğìÈpëYÈHÔ“ˆ°êKY^\İ[K˜ÛÛ™š\›XYÈÛÛHÈÛÛÜ››È™]Y\ˆÔ“‹\ØY™JKœH[ˆZ[Hœœ^]ÜšYÚ\İ
L‘JH\›İ˜YÜË‚‚ˆÈÈLËˆ\[™X›İÛÙTSHØ]HH]Y]ÜšXHH\[™0ê›˜ÚX\È˜HÒB‚”°ìŞ[[È][HH\İHHÙYİ\˜[°éØHH[™œ˜Y\İ]\˜H™YÚ\İ˜YH›Â˜˜XÚÛÙÈ
][HHÈÑPÓÓ‘Ğ”RSŠNˆœ˜]H[Z]\İšXpëYË›İpéğèÛÈ˜B˜›Ü™KœH]Y]
ÜØØ[ˆHÙYÜ™YÜÊÑ\[™X›İÔ™[›İ˜]JĞÛÙTS˜HÒKœÛ0ë]XØHHYÜÈHPHXZ\Èš\ğë]™[Û[ÚÙH\İXZ\ÈÛÛ\]È‹‚‘\ØÛÛYÜÈÜÈ°êœÈ][œÈYXğè›šXÛÜÈÙ[HXÚ\ğèÛÈH›Ù]È[™[BŠ˜]H[Z]\İšXpëYÈ^YÙH\ØÛÛ\ˆ[H›İ™YÜˆH[™œ˜Y\İ]\˜H8 %”™Y\ËÕ\İ\Ú8 %›Ü˜HÈ\ØÛÜÈÙ[H\ÜØHXÚ\ğèÛÈÈ\İpè\š[ÊK‚‚ŠŠ’[\[Y[YÊŠ‚‹H™Ú]X‹Ù\[™X›İ[[8 %]X[^˜péğíY\ÈÙ[X[˜Z\ÈYÜ\Y\Âˆ
Z[›Ü‹Ü]Ú
H˜HœX
˜Z^ŠKØ\™ÛØˆ
\İÛÛK[ÛŞ[XÛÜ™X
HHÚ]X‹XXİ[ÛœØ‚‹H™Ú]X‹İÛÜšÙ›İÜËØÛÙ\[[[8 %[°è[\ÙHÛÙTS[H\ÚÔˆ˜BˆXZ[˜
ÈÙ[X[˜[
Ü›ÛŠKˆğìÈ˜]˜\ØÜš\]\\ØÜš\HXİ[ÛœØ8 %ˆ\İ°èÛÈ[Hİ\ÜHÙšXÚX[›ÈÛÙTS
\İHH[™İXYÙ[œÂˆİ\ÜY\È˜HØİ[Y[péğèÛÈÙšXÚX[°èÛÈ[˜ÛZH\İ
K‚‹H›İ›È›Øˆ\[™[˜ŞKX]Y][H\XØ][Û‹[[8 %œH]Y]ˆKX]Y][]™[ZYÚ›Ü]YX[HH™\™YH
›ÙH[HÙHˆH\Úˆ˜HXZ[˜Y\Û[ÈY°èÛÈÜÈİ]›ÜÈ›ØœÊK‚‚ŠŠ‘XÚ\ğèÛÈÛØœ™HÈ™\ÚÛ
ŠˆKX]Y][]™[ZYÚ°èÛÈ[Ù\˜]X›™[HÙ[H™\ÚÛˆÈ›Ú™]È°èH[Hˆ[™\˜Xš[YY\È[Ù\˜]Xœ°êKY^\İ[\È
XÛİH]ZYšXH^Ù[œØ
H\ØÛØ™\\È[È›Ù\‚˜œH]Y]ØØ[[\ÈHXÚY\ˆÈ™\ÚÛ8 %^Ù[œØ0êB™\[™0ê›˜ÚXH\™]HH\ØYHH™\™YBŠÛÜšØ›ÛÚË[Y]Y]KØØÛÜšØ›ÛÚË]™\šYšY\‹Ø\HÈY°èÛÈB›pî›\ÜÈZ]Ü™\È˜H™\šYšXØpéğèÛÈÜ^˜YJKHÛÜœ™péğèÛÈ^YÚ\šXB˜œH]Y]š^KY›Ü˜ÙXÛÛHİÛ™Ü˜YHHXZ›Üˆ™\œÚ[Ûˆ
^Ù[œĞËŒ›XZ\È[YÛÈ]YHÈŒ]X[
H8 %°èÛÈ0êH[ÛÈ˜H›Ü°éØ\ˆ0èÈÙYØ\È[XBœÙ\ÜğèÛÈÛØœ™HÒKH›Ü]YX\ˆHÒHš\ÜÛÈÙ[HÛÜœ™péğèÛÈ\ÜÛ°ë]™[B™\™YHğìÈÙ\˜\šXH[HÚXÚØ›Ş™\›Y[È\›X[™[HÙ[HpéğèÛÈÜÜğë]™[Š[İ]›È°èH™YÚ\İ˜YÈ[\È˜H™YÜ˜H›°èÛÈ™Y^˜H\İ\ËØÜš]0ê\š[ÜÈ˜B™›Ü°éØ\ˆ™\™Hˆ8 %\]ZHÈÜÜİÎˆ°èÛÈÜšYH[HØ]H]YH[˜ØHÙHšXØ\‚™\™HH›Ü›XHYğë][XJKˆYÚØÜš]XØ[ÛÛ[X[H›Ü]YX[™ÈB™\™YNÈ[Ù\˜]XØİØšXØ[HH›Ü˜HÈØ]H]]ÛX]^˜YËœ™]š\ğè]™Z\ÈÛÛHœH]Y]ØØ[Ù[HKX]Y][]™[]X[™È™XÚ\Ø\‚™È]XY›ÈÛÛ\]Ë‚‚ŠŠYÈ™X[YÛÈ[\ÈHÛÛ[Z]\ŠŠˆHš[YZ\˜H[]]˜HH[œÙ\š\ˆÂš›Øˆ\[™[˜ŞKX]Y]›ÈYZ[ÈÈ\œ]Z]›ËšXHY]\YÛİHÙ[Bœ]Y\™\ˆ\ÈX\È[š\ÈHØX™péØ[ÈÈ›ØˆÙXİ\š]K\Û[ÚÙX°èH^\İ[B›ÙÛÈ\Ú\È
ÙXİ\š]K\Û[ÚÙN˜
È˜[YNˆ‹‹˜
KZ^[™È[œË[Û˜Â˜[Y[İ][Z[]\Ø0ìÜ™°èÛÜÈÛØˆÈ›Øˆ›İ›È8 %PSSÚ[]XØ[Y[H[°è[YË\šXH]YXœ˜YÈHÒH[Z\˜Kˆ\ØÛØ™\È˜[Y[™ÈÛÛHœË^X[[Š›ÙHYHX[[›ØY
‹‹ŠH˜\İ[™È\ÈÚ]™\ÈH›ØœØ\Ü\˜Y\ÊB˜[\ÈÈÛÛ[Z]°èÛÈÛÛ™šX[™ÈğìÈ[HZ]\˜Hš\İX[ÈY™‹‚‚˜œH]Y]KX]Y][]™[ZYÚÛÛ™š\›XYÈ[\ÈØØ[Y[H
^]\ÂŒˆ[™\˜Xš[YY\È°êKY^\İ[\ÈšXØ[HX˜Z^ÈÈ™\ÚÛ
Kˆœš]\İ[˜
MÈ\ÜÛİKH[YÊKœØÈK[›Ñ[Z]œ™]Y\‚‹KXÚXÚØ›ÜÈÈ\œ]Z]›ÜÈ
[[
H\›İ˜YÜËˆ°èÛÈ0êHÜÜğë]™[›Ù\‚ÛÙTSÑ\[™X›İØØ[Y[H8 %™\šYšXØpéğèÛÈ™X[šXØH˜H]X[™ÈH‚™›ÜˆX™\H›ÈÚ]X‹‚‚ŠŠ”[™[KY\ÛXHÙpéğèÛÈÈ˜XÚÛÙÈÈ\İpè\š[Ë°èÛÈX˜[™Û˜YÊŠˆ˜]B›[Z]\İšXpëYÈ
™Y\ËÕ\İ\Ú
K›İpéğèÛÈ˜H›Ü™H›Â˜Ø\KÙÙ[Z[šKÊ˜Û0ë]XØHHYÜÈHPHXZ\Èš\ğë]™[Üˆ\Ú›Ø\™œÛ[ÚÙH\İÛØœš[™È\›Z\ÜÚ[ÛœËTÛXŞXØÜ›ÜÜËSÜšYÚ[‹SÜ[™\‹TÛXŞXÂ˜ØXÚKÛpê]ÙÜÈ[™\Ü\˜YÜËˆØØ[ˆHÙYÜ™YÜÈ
^ˆÚ]XZÜËÂY™›ZÙÈ˜HÒJH[X°ê[H°èÛÈ›ÚHYXÚ[Û˜YÈ™\İHÙpéğèÛÈ8 %ÛÛœÚY\˜\‚˜ÛÛ[È°ìŞ[[È][HHY\ÛXHœ™[K‚‚ˆÈÈLˆØØ[ˆHÙYÜ™YÜÎˆ™Xİ\œÛÈ˜]]›ÈÈÚ]XˆXš[]YÈ
°èÛÈ™XÚ\ÛİHHÚ]XZÜËİY™›ZÙÈ˜HÒJB‚”°ìŞ[[È][H˜]\˜[HÙpéğèÛÈLÈ
ØØ[ˆHÙYÜ™YÜËZ^YÈÛÛ[Âœ[™0ê›˜ÚXH[JKˆ[\ÈHYXÚ[Û˜\ˆÚ]XZÜØØY™›ZÙØÛÛ[ÂÛÜšÙ›İÈHÒH
HÛÛpéğèÛÈ\Üİ[ZYH˜HÙpéğèÛÈ[\š[ÜŠK™\šYšXØYÈšXB˜Ú\H™\ÜËÛÛ]™MÛÛ\]X[YYXÙHÈÚ]Xˆ°èHÙ™\™XÚXH[ÛÂ›˜]]›È8 %\ØÛØ™\È]YHÚ[Nˆ
ŠœÙXÜ™]ØØ[›š[™ÈH\Ú›İXİ[ÛˆğèÛÂ™Ü˜]Z]ÜÈH]]Ûpè]XÛÜÈ[H™\ÜÚ]0ìÜš[ÜÈ0î˜›XÛÜÊŠ‹HÈ™\ÜÚ]0ìÜš[Â[šHXØX˜YÈHš\˜\ˆ0î˜›XÛÈ
XÚ\ğèÛÈÈ\İpè\š[Ë[İ]˜YH[B›™XÙ\ÜÚYYHHXš[]\ˆÛÙTS˜HÙpéğèÛÈLÈ8 %Ú]XˆY˜[˜ÙYÙXİ\š]Bœ\˜H™\ÜÚ]0ìÜš[Èš]˜YÈ°èÛÈ^\İH[HÛÛH\ÜÛØ[œ™YKÔ›ËğìÈ[Bœ[›ÜÈ[\œš\ÙJK‚‚ŠŠ‘\İYÈÛÛ™š\›XYÈšXHTJŠˆ
ÙXİ\š]WØ[™Ø[˜[\Ú\ØÈ™\ÜÚ]0ìÜš[ÊN‚˜ÙXÜ™]ÜØØ[›š[™ØHÙXÜ™]ÜØØ[›š[™×Ü\ÚÜ›İXİ[Û˜°èHš[š[B˜[˜X›YÛŞš[šÜÈ[ÈÜ›˜\ˆÈ™\È0î˜›XÛÈ8 %˜YH˜H˜^™\ˆ›ÈğìÙYÛË‚XÚYÈH°í\Ë[X°ê[HšXHTNˆ
Š‘\[™X›İ[\ÊŠ‚Š[™\˜Xš[]KX[\ØH˜\ÙH]YHÙ\˜HÜÈ]š\ÛÜÈH\[™0ê›˜ÚXB[™\°è]™[]YHHÙpéğèÛÈLÈ\Üİ[ZXH°èHš\ˆ[ÈÈ\[™X›İ[[X\Â°êH[XHÛÛ™šYİ\˜péğèÛÈÙ\\˜YJH\İ]˜H
Š™\ØXš[]YÊŠ‹ˆÛÛ™š\›XYÈÛÛHÂ\İpè\š[È[\ÈH]Y\ˆ
0êHÛÛ™šYİ\˜péğèÛÈHÛÛKÜ™\ÜÚ]0ìÜš[ËØ]YÛÜšXBœ]YH^YÙH\›Z\ÜğèÛÈ^0ëXÚ]JHHXš[]YÈšXHÚ\HVUœ™\ÜËË‹‹‹İ[™\˜Xš[]KX[\Ø
ŒÙ[HÛÜœÊH
ÈÚ\HVUÒœ™\ÜËË‹‹ˆY‚œÙXİ\š]WØ[™Ø[˜[\Ú\ÖÙ\[™X›İÜÙXİ\š]Wİ\]\×VÜİ]\×OY[˜X›YŠœÈ]]Ûpè]XÛÜÈHÛÜœ™péğèÛÈ]X[™È[XH\[™0ê›˜ÚXH[HÕ‘HÛÛšXÚYÈ8 %˜ÛÛ\[Y[HÈ\[™X›İ[[HÙpéğèÛÈLË]YHğìÈÛØœšXH]X[^˜péğèÛÂ™H›İ[˜HÜˆÜ›Û›ÙÜ˜[XK°èÛÈ[™\˜Xš[YYH\ÜXğëYšXØJK‚‚“™[š[HğìÙYÛÈ›İ›Ë™[š[XHˆ8 %]Y[°éØHHÛÛ™šYİ\˜péğèÛÈÂœ™\ÜÚ]0ìÜš[ÈšXHTK›Ü˜HÈ\ØÛÜÈHÚ]ˆ™YÚ\İ˜YÈ\]ZH˜H°èÛÂ™\XØ\ˆÈXÚYÈ[XHÙ\ÜğèÛÈ]\˜K‚‚ŠŠ”[™[KY\ÛXHœ™[JŠˆ˜]H[Z]\İšXpëYÈ
™Y\ËÕ\İ\Ú
Kœ›İpéğèÛÈ˜H›Ü™H›ÈØ\KÙÙ[Z[šKÊ˜Û0ë]XØHHYÜÈHPHXZ\Âš\ğë]™[Üˆ\Ú›Ø\™Û[ÚÙH\İÛØœš[™È\›Z\ÜÚ[ÛœËTÛXŞXÂ˜Ü›ÜÜËSÜšYÚ[‹SÜ[™\‹TÛXŞXØØXÚKÛpê]ÙÜÈ[™\Ü\˜YÜË‚‚ˆÈÈLKˆ™]š\ğèÛÈÜÈMœÈX™\ÜÈ[È\[™X›İˆHH˜Z^Èš\ØÛÈY\ØÛY\Ë\TØÜš\È™Z™Z]YÈÜˆ[˜ÛÛ\]Xš[YYH™X[‚“È\[™X›İ
Xš[]YÈ˜HÙpéğèÛÈLÊHXœš]HMœÈ˜Hš[YZ\˜B˜\œ™Y\˜Nˆ[\ÈHÚ]XˆXİ[ÛœËHÜ\ÈZ[›Ü‹Ü]ÚÈœH
BœXÛİ\ÊHHH[\ÈHXZ›Üˆ™\œÚ[ÛˆÈœKˆYYÈÈ\İpè\š[Îˆ™]š\Ø\‚œÜˆÜ™[HHš\ØÛËÛÛYpéØ[™È[\ÈH˜Z^Èš\ØÛË‚‚ŠŠ“Y\ØÛY\ÈÙ[H[˜ÚY[JŠˆ
Xİ[ÛœËğìÈ[™œ˜Y\İ]\˜HHÒJN‚˜Xİ[ÛœËØÚXÚÛİ]8¡¤ËXİ[ÛœËİ\ØYX\Y˜Xİ8¡¤Ë˜Ú]X‹ØÛÙ\[XXİ[Û˜ø¡¤Xİ[ÛœËÜÙ]\[›ÙX8¡¤Ë‚‚ŠŠ‘Ü\ÈZ[›Ü‹Ü]ÚÈœJŠˆ
ÛÚÙ›Ü›KÜ™\ÛÛ™\œØ˜[œİXÚËÜ™XXİ\›İ]\˜[œİXÚËÜ™XXİ\İ\˜\Û[\YÚ[‹\™XXİ\™Yœ™\ÚXZ\È[JH8 %XÚYÈ™X[[\ÈB›Y\ØÛ\ˆÈØÚÙš[H]YHÈ°ìÜš[È\[™X›İÙ\›İH\˜H\ÜØHˆ\İ]˜B™›Ü˜HHÚ[˜Ü›ÛšXH
KXØXÚPLKKŒ˜˜[[™ÊKœHÚX˜[]˜HÛÛBˆœXÚØYÙKšœÛÛˆHXÚØYÙK[ØÚËšœÛÛˆ‹‹ˆ\™H[ˆŞ[˜Èˆ8 %Y\ÛXH\›XY[H°èB™Øİ[Y[YHÈ›Ú™]È
™\ÛÛpéğèÛÈHØÚÙš[H]™\™ÙH[™HœHØØ[BÒJKˆÛÜœšYÚYÈ›Ù[™ÈœœPL[œİ[\™]È›Èœ˜[˜ÚHˆÂ‘\[™X›İ
Ú]ÚXÚÛİ]Xˆ‹‹ˆÜšYÚ[‹Ù\[™X›İË‹‹˜[œİ[\‹˜ÛÛ[Z]\ˆÈØÚÙš[H™YÙ[™\˜YËÚ]\ÚH›ÛH›Èœ˜[˜Ú™[[İÈÂ‘\[™X›İ
H8 %ÒHšXÛİH™\™H\Ú\ËY\ØÛYH›Ü›X[Y[Kˆ™\šYšXØYÂ›ØØ[Y[H[\ÎˆœHÚX[\Ëœš]\İ[˜œØÈK[›Ñ[Z]˜œH[ˆZ[œ^]ÜšYÚ\İ
L‘K™[]˜[HÜˆ[›Û™\‚•[”İXÚÈ›İ]\‹Ôİ\
HÙÜÈ\›İ˜YÜÈÛÛH\È\[™0ê›˜ÚX\È›İ˜\Ë‚‚ŠŠ•\TØÜš\KKŒÈ8¡¤ˆËŒŒ‹™Z™Z]YÊŠˆ8 %YYÈÈ\İpè\š[È˜HÛÛYpéØ\‚œ[\ÈXZ›ÜœÈÜˆ\İKˆÈËŒ0êHH™Y\ØÜš]HÈÛÛ\[YÜˆ[HÛÈB™\]Z\H\TØÜš\
H[Y\˜péğèÛÈ[HH‹™\Ù\˜YH˜H[XH™[X\ÙHB˜[œÚpéğèÛÈğìÈÛÛH]š\ÛÜÈH\™XÚXpéğèÛÊKˆ\İYÈØØ[Y[H
Ú]˜ÚXÚÛİ]Èœ˜[˜ÚÈ\[™X›İ
ÈœœPLÚX
Nˆ˜[H™X[BœY\ˆ\[™[˜ŞK°èÛÈ0êHØÚÙš[H8 %\\ØÜš\Y\Û[ËŒ
™\œğèÛÂ˜]X[È›Ú™]ÊH^YÙH\\ØÜš\M‹ŒKŒ˜[˜ÛÛ\]0ë]™[ÛÛB•ÈÈÜˆÛÛ\]Ëˆ°èÛÈ›Ü°éØYÈÛÛHK[YØXŞK\Y\‹Y\Ø
X\ØØ\˜\šXH[XBš[œİ[péğèÛÈÙ[Z[˜[Y[H]YXœ˜YJKˆÛÛY[YÈÈXÚYÈ˜HˆHYYÂ˜\[™X›İYÛ›Ü™H\ÈXZ›Üˆ™\œÚ[Û˜8 %\[™X›İ™XÚİHH‚œÛŞš[šË\˜HH™XXœš\ˆHY\ÛXH›ÜÜİH]0êHÈXÛÜÜÚ\İ[XH
[ÈY[›ÜÂ˜\\ØÜš\Y\Û[
Hİ\Ü\ˆÈÈH™\™YK‚‚ŠŠZ[™H[™[\Ë°èÛÈ™]š\ØY\È™\İHÙ\ÜğèÛÊŠˆ\Û[x¡¤ŒL˜\Û[ÚœØx¡¤ŒLÛØ˜[ØMx¡¤ŒMÈ
›İ°è]™Z\È\[™0ê›˜ÚX\È[™HÚHB˜ÛÛH\\ØÜš\Y\Û[™]š\Ø\ˆ[ÜÊK›Ùø¡¤
]Y[°éØHHTB˜ÛÛšXÚYK\ØYÈ[H°è\šX\È˜[YpéğíY\ÊK™XXİY^K\XÚÙ\˜x¡¤ŒL˜XÚYK\™XXİ8¡¤ŒK[˜Ø[˜\Ë\›ØK¸¡¤Œ‹ŒË\\ËÛ›ÙXŒ¸¡¤Œ‹‚‚ˆÈÈL‹ˆ™\ÜÚ]0ìÜš[È›ÛİHHÙ\ˆš]˜YÎÈÛÙTS™[[İšYÈ
\[™0ê›˜ÚXH\™]HHXÚ\ğèÛÈHÙpéğèÛÈLÊB‚‘XÚ\ğèÛÈÈ\İpè\š[Îˆ™]™\\ˆHš\ÚXš[YYH0î˜›XØH]YH[šHÚYÂ˜YİYHğìÈ˜HšXXš[^˜\ˆÈÛÙTS˜HÙpéğèÛÈLËˆÛÛœÙ\]pê›˜ÚXH0êXÛšXØB˜]š\ØYH[\ÈHYÚ\ˆÛÙTSØÛÙHØØ[›š[™È[H™\ÜÚ]0ìÜš[Èš]˜YÂ›°èÛÈ^\İH[HÛÛH\ÜÛØ[œ™YKÔ›È
ğìÈ[\œš\ÙJH8 %›Û\ˆHšXØ\‚œš]˜YÈ˜\šXHÈÛÜšÙ›İÈÛÙ\[[[›Û\ˆH˜[\ˆ[HÙH‹Â›Y\Û[È™Z]È]YHH[™\İYØpéğèÛÈHÙpéğèÛÈLÈ[˜ÛÛ›İHÜšYÚ[˜[Y[K‚‚ÛÛ™š\›XYÈÛÛHÈ\İpè\š[È]X[ÜÈ°êœÈØ[Z[šÜÈÙYİZ\ˆ
X[\‚œ0î˜›XÛËZ^\ˆ˜[[™ËİH™[[İ™\ŠH[\ÈHYÚ\ˆ8 %]Y[°éØHBš\ÚXš[YYHH™\ÜÚ]0ìÜš[È0êHØ]YÛÜšXH]YH^YÙH\›Z\ÜğèÛÈ^0ëXÚ]K‚‘\ØÛÛYÈ™[[İ™\ˆÈÛÜšÙ›İË‚‚ŠŠ‘™Z]ÊŠ‚‹HÚ\HVUÒ™\ÜËÛÛ]™MÛÛ\]X[YYHYˆš]˜]O]YX8 %ˆ™\ÜÚ]0ìÜš[Èš]˜YÈH›İ›Ë‚‹H™Ú]X‹İÛÜšÙ›İÜËØÛÙ\[[[™[[İšYÈ
Ú]›X
H8 %°èÛÈ˜^ˆÙ[YÂˆX[\ˆ[HÛÜšÙ›İÈ]YH[˜ØH˜ZHÛÛœÙYİZ\ˆšXØ\ˆ™\™H™\İHÛÛK‚‹HÙXÜ™]ÜØØ[›š[™ØØÙXÜ™]ÜØØ[›š[™×Ü\ÚÜ›İXİ[Û˜›Û[Bˆ]]ÛX]XØ[Y[H˜H\ØX›Y
ğìÈ^\İ[HHÜ˜péØH[H™\È0î˜›XÛËˆÛÛ™š\›XYÈšXHTJH8 %\™H\Ü\˜YK°èH]š\ØYH˜HÙpéğèÛÈLÛÛ[ÂˆÛÛœÙ\]pê›˜ÚXH[\0ëXÚ]HH]X[]Y\ˆ™]™\œğèÛÈ]\˜HHš\ÚXš[YYK‚ˆ\[™X›İÜÙXİ\š]Wİ\]\ØÛÛ[XH[˜X›Y
°èÛÈ\[™HBˆš\ÚXš[YYJK‚‚‘\[™X›İHÈØ]H\[™[˜ŞKX]Y]
œH]Y]KX]Y][]™[ZYÚ
B˜ÛÛ[X[H[˜Ú[Û˜[™È›Ü›X[Y[H[H™\ÜÚ]0ìÜš[Èš]˜YÈ8 %™[š[HÜÂ™Ú\È\[™HHÒTË‚‚ˆÈÈLËˆ[˜Ø[˜\Ë\›Ø]X[^˜YÈ
K‹È8¡¤ˆ‹ŒË
HH[š[XpéğèÛÈH[˜YH\È˜\œ˜\ÈH™Y[˜Ú[Y[Â‚•\İpè\š[ÈY]H˜H™]š\Ø\ˆğìÈÈ[˜Ø[˜\Ë\›Ø[™H\ÈXZ›ÜœÂœ[™[\ÈHÙpéğèÛÈLH8 %0êHHXˆ\ØYH›È^ÜH‹Ô‘ÈÈZ[™[°î›šXØHÛÛHÚ[˜ÙH™X[HY[Ü˜\ˆ[ÛÈÛÛ˜Ü™]È
Ú[™Ù[ÙÈ[šBˆ”\™›Ü›X[˜ÙH[\›İ™[Y[ÈˆØXÚH•H˜HÜ˜YY[\È[™X\™\ËØXÚHBœ\œÙHHÔÔÊKˆ\İYÈØØ[Y[H
Ú]ÚXÚÛİ]Èœ˜[˜ÚÂ‘\[™X›İ
ÈœœPLÚX
NˆY\ÛXH\›XY[HHØÚÙš[H›Ü˜HBœÚ[˜Ü›ÛšXH°èHš\İHX\È™^™\È™\İHÙ\ÜğèÛÈ
KXØXÚX˜[[™ÊK˜ÛÜœšYÚYHÈY\Û[È™Z]Ëˆœš]\İ[˜œØÈK[›Ñ[Z]œBœ[ˆZ[œ^]ÜšYÚ\İ
L‘JH\›İ˜YÜÈÛÛHH™\œğèÛÈ›İ˜K‚“Y\ØÛYÈÙ[HXZ\È[™\İYØpéğèÛÈ8 %°èÛÈXÚYÈ˜YH]YH]YXœ˜\ÜÙK‚‚ŠŠ[š[XpéğèÛÈH[˜YH\È˜\œ˜\ÈH™Y[˜Ú[Y[ÊŠˆ8 %YYÈÙ\\˜YÂ™È\İpè\š[Îˆ™\XØ\ˆ\È[š[XpéğíY\ÈH[HÛÛ\Û™[HH^[\È
Ø\™Âˆ˜™[ÈˆÛÛHœ˜[Y\‹[[İ[Û˜Üš[™È\ÚXÜËİ™\ˆÜ
H›ÜÈÚYÙ]È]YB™š^™\ÜÙ[HÙ[YËX[[™ÈÈ\ÚYÛˆ]X[ÈÚ]Kˆ[™\İYØpéğèÛÈ°ê]šXBš[\Ü[NˆHXZ[Üˆ\HH[™œ˜Y\İ]\˜HH[š[XpéğèÛÈ
Šš°èH^\İXJŠ‚™H°èH\˜H™[H\Ù[šYH8 %Ù^Yœ˜[Y\ÈÛX[KZ[˜
˜YH
È]™HİXšYJHÛÛB˜[š[X][Û‘[^X°èHšXYÈÚYÙ]HÚYÙ]\ÙH›İ]\ËÚ[™^ŞŠX]›Z[ŠK
H
ˆ
H]˜]°ê\ÈHÚYÙ]XØ\™Ş]0êHØYB˜
‹]ÚYÙ]X›ÙKŞİ™\ˆÛÛH[]˜péğèÛÈHÛÛXœ˜KH™\ÜZ]ÈB˜™Y™\œË\™YXÙY[[İ[Û˜°èH[\[Y[YËˆÈÜ°èYšXÛÈH˜\œ˜\ÈÂ”™XÚ\È[HH[š[XpéğèÛÈH[˜YH
Š™[X™\˜Y[Y[JŠˆ\ÛYØYBŠ\Ğ[š[X][ÛXİ]™O^Ù˜[Ù_XÛÛHÛÛY[0è\š[È^XØ[™È[HYÈ™X[B™›XÚÙ\ˆ›ÈZ^ÈHHØYHİ™\‹°èHÛÜœšYÚYÈ[HÙ\ÜğèÛÈ[\š[ÜŠH8 %°èÛÂ›Y^YËÜˆ™\ÜZ]È0èÛÜœ™péğèÛÈ°èHØİ[Y[YK‚‚“È]YH˜[]˜HH™\™YNˆ\ÈÈ˜\œ˜\ÈH™Y[˜Ú[Y[ÈÜˆÜ˜Ù[YÙ[B™È\
˜[šÚ[™Ë]ÚYÙ]X›ÙKŞ˜][™Ë]ÚYÙ]X›ÙKŞ˜[œÚYÚ\ÚYX˜\‹ŞÙ\È™X\›İ™Z][™È›ÛX[K\˜[šÚ[™ËYš[
H°èB[š[H[XH˜[œÚ][Û˜HÚY™[HØ[Xœ˜YKX\È[HğìÈ\Ü\˜Bœ]X[™ÈÈYÈ
›]YH\Ú\Êˆ8 %H\™İ\˜H˜\ØÙH\™]È›È˜[Üˆš[˜[›Âœš[YZ\›È™[™\ˆ
Ù]YHšXH[›[™Hİ[JK[0èÛÈ[˜ØH˜Ü™\ØÙHˆ˜B™[˜YHš\ğë]™[Y\Û[ÈÛÛHH˜[œÚ][Ûˆ›ÛK‚‚YXÚ[Û˜YÈÙ^Yœ˜[Y\ÈÛX[KYš[Z[˜
ØØ[V8¡¤ŒK˜˜[œÙ›Ü›K[ÜšYÚ[ˆY8 %XZ\È˜\˜]È]YH[š[X\ˆÚYH™\™YKœ›ÙHğìÈ›ÈÛÛ\ÜÚ]ÜŠHÛÛ[È[š[X][Û˜˜H°ìÜšXH›ÛX[K\˜[šÚ[™ËYš[˜ÛÛH]˜\ÛÈ\ØØ[Û˜YÈÜˆ0ë[™XÙH˜\È\İ\È
ML
ÈZ[ŠKL
JX\È[B˜˜[šÚ[™Ë]ÚYÙ]X›ÙKŞØ[œÚYÚ\ÚYX˜\‹Ş
HH]˜\ÛÈš^ÈHML\Â›˜H]˜[XpéğèÛÈ
˜\œ˜H0î›šXØJKˆÈ]˜\ÛÈØ\˜[H]YHH˜\œ˜HğìÈÛÛYpéØHB˜Ü™\ØÙ\ˆ\Ú\È]YHÈØ\™ÈÚYÙ]\›Z[˜HH[˜\‹°èÛÈÚ[][0è›™[Ë‚˜™Y™\œË\™YXÙY[[İ[Û˜\ÛYØHH[š[XpéğèÛÈ›İ˜H[ÈÛÛHH^\İ[K‚”Ù[Hœ˜[Y\‹[[İ[Û˜™[H™[š[XH\[™0ê›˜ÚXH›İ˜H8 %™\›Èİ\İÈB˜[™KY\ÛXHš[ÜÛÙšXHH[š[XpéğèÛÈÔÔË[Û›H°èH\ØYH[HÙÈÈ\‚‚ŠŠ•™\šYšXØpéğèÛÈ[H˜]™YØYÜˆ™X[ÛÛH[H[\›YH˜[ÛÈ[™\İYØYÊŠˆB˜˜\œ˜H\™XÙ]H˜]˜YH[HØØ[V

XÜˆ°è\š[ÜÈÙYİ[™ÜÈ[ÈÚXØ\ˆšXB˜Ù][š[X][ÛœÊ
X8 %^Tİ]Nˆœ[›š[™È˜X\Èİ\œ™[[YNˆ˜ÛÛ™Ù[YËˆ\ÛÛYÈÛÛ[È[Z]péğèÛÈÈ[XšY[HH\İK°èÛÈYÎˆÂœ›İÜÙ\ˆ[™H°èÛÈ\İ]˜H[Hš[YZ\›È[›È
Hœ›İÜÙ\ˆ[™H\È›İ™\Ü^YYˆ›È\œ›ÈÈØÜ™Y[œÚİ
KHÈÚ›ÛYH\ØXÙ[\˜KÜ]\ØHÂ˜]˜[°éÛÈH[\ÈH[š[XpéğíY\ÈÔÔÈ[HX˜\È[HÙYİ[™È[›È8 %Y\ÛXB˜Û\ÜÙHH[Z]péğèÛÈ°èH[˜ÛÛ˜YHÛÛHÈ[™ÈÈ[˜Ø[˜\Ø[XBœÙ\ÜğèÛÈ[\š[Ü‹ˆÛÛ™š\›XYÈ›Ü°éØ[™È[š[K™š[š\Ú

XšXH”ÎˆH˜\œ˜B˜ÚYØH^][Y[H›È˜[Üˆš[˜[ÛÜœ™]È
MËœHL	HÈÛÛZ[™\ŠK‚‚˜œš]\İ[˜
MÈ\ÜÛİKH[YÊKœØÈK[›Ñ[Z]œ™\Û[›ÜÈ\œ]Z]›ÜÈØØYÜÈ
ğìÈpëYÈHÔ“ˆ°êKY^\İ[JKœBœ[ˆZ[
™\›È]Y[°éØH›ÈÜ°éØ[Y[ÈH[™JH\›İ˜YÜË‚‚ˆÈÈLˆXYÛ°ìÜİXÛÈH[\ÜpéğèÛÈ˜Z^0è]™[H•[\ˆ[ÙÈHÛÛ\]Xš[YYHˆ˜H™]š\ğèÛÈ
][HH\İHHY[ÜšX\ÈÈZ]Üˆ˜^šYH[È\İpè\š[ÊB‚•\İpè\š[È›İ^H[XH\İHÜ˜[™HHY[ÜšX\È›ÈZ]Ü‹Ü™]š\ğèÛÈBš[\ÜpéğèÛÈ
›ÙÜ™\ÜÛÈÜˆ\İ0èYÚ[ËÛÛ\\˜péğèÛÈš\İX[\™š\Âœ™]][^°è]™Z\Ë[ÙÈHÛÛ\]Xš[YYKXYÛ°ìÜİXÛÈ˜Z^0è]™[œ™[X\X[Y[ÈHÛÜ™\ËİX™[\Ëİ˜[YpéğíY\ËÜ]›İÙYİ\˜[°éØHH›Ü™K™]š\ğèÛÈH[\ÜØØİ[\Ë˜ÜÜØ
Kˆ\ØÛÛYÈÛÛYpéØ\ˆ[ÜÈÚ\Âš][œÈXZ\È]]ËXÛÛYÜË[X›ÜÈ˜H[HH™]š\ğèÛÈ
™]šY]ËŞ
KÙ[Bš[™œ˜Y\İ]\˜H›İ˜K‚‚ŠŠXÚYÈ°ê]š[È[\Ü[K[\ÈH[\[Y[\ˆ]X[]Y\ˆÛÚ\ØJŠ‚š[™\İYØpéğèÛÈ[˜ÛÛ›İH]YH”™YÜ˜\ÈH[\ÜpéğèÛÈ™]][^°è]™Z\ÈÜ‚›[Ù[ÈH[š[Hˆ8 %][H]YHÈÑPÓÓ‘Ğ”RS‹›Y\İ]˜HÛÛ[Âœ[™[H›È˜XÚÛÙÈ
ÙpéğèÛÈJH8 %
Šš°èH\İ]˜H[\[Y[YÈH[H\ÛÊŠ‚™\ÙHœÈ[YØ\È
ÌM‹ÌŒKÌÍÊNˆ[\Ü›Ùš[XØØ]™R[\Ü›Ùš[XÂ˜X]Ú[™Ò[\Ü›Ùš[XØY\[\Ü›Ùš[XŠÜ˜ËÛX‹Ú[\Ü]ÛÜšØ™[˜ÚØ
KÛÛHRHÛÛ\]H[H™]šY]ËŞŠ›İ0èÛÈ”Ø[˜\ˆ\™š[‹]š\ÛÈH™X\XØpéğèÛËØY\péğèÛÈ]]Ûpè]XØH[Âœ™XXœš\ˆ[XH[š[HÈY\Û[È[Ù[ÊKˆÈ˜XÚÛÙÈ\İ]˜H\Ø]X[^˜YÂ›™\ÜÙH][H8 %ÛÜœšYÚYÈ[ÈÛÛH\İHÙ\ÜğèÛËÙ[H™Z[\[Y[\ˆ˜YK‚‚ŠŠ‘XYÛ°ìÜİXÛÈ˜Z^0è]™[
Šˆ[\ÜXYÛ›ÜİXÜÑ^Ü^[ØYŠÜ˜ËÛX‹Ü™]šY]ËY^ÜØ
H[ÛHÈÙ[™\˜]Y]š[KÚY]™šY[]T\˜Ù[]Y]XYÛ›ÜİXÜÈXH\\ˆÈ]YHÚY]Ô›İÜØÂ˜XYÛ›ÜÙR[\ÜYÚY]°èHØ[İ[[H8 %™[š[HYÈ›İ›ÈÛÛ\]YËˆ0æ›šXÛÂ˜İZYYÎˆ[XYÙ\Ö×K™]U\›
˜\ÙMH[XYÙ[H[X]YK˜ÛÜšØ›ÛÚË[Y]Y]KØ
H0êH™[[İšYÈ[\ÈÈİÛ›ØYÜœ]YH[™›HÂ˜\œ]Z]›ÈÙ[HZY\ˆHXYÛ›ÜİXØ\ˆ[H›Ø›[XHH[\ÜpéğèÛÎÈÈ™\İÈÂš[™[0è\š[È
˜[YXØ[˜ÚÜ˜Ø›Ü›X]
H0êH™\Ù\˜YËˆ›İ0èÛÈ˜Z^\‚™XYÛ°ìÜİXÛÈˆ›ÈØX™péØ[ÈÈZ[™[”™[]0ìÜš[ÈHšY[YYHBš[\ÜpéğèÛÈˆ°èH^\İ[H
™]šY]ËŞÙpéğèÛÈN
KÛÛB˜™]™[Y˜][ØİÜ›ÜYØ][Û˜˜H°èÛÈÙÙÛX\ˆÈ]Z[Ï˜[Â˜ÛXØ\‹ˆ™X\›İ™Z]HÈY\Û[ÈY°èÛÈ›ØŠØHİÛ›ØY˜°èH\ØYÈ
Ù[Bš[\ˆÛÛ\\[YÊH[H\ÙKY\Ú›Ø\™Y^ÜØÂ˜^Ù\[Û‹\[™[]ÚYÙ]X›ÙKŞ‚‚ŠŠˆ•[\ˆ[ÙÈHÛÛ\]Xš[YYHŠŠˆ]0êHYÛÜ˜K]X[™ÈHÛÛ™šX[°éØHB˜ØX™péØ[ËÜ™YÚpèÛÈ0êH˜Z^H
™YYĞÛÛ™š\›X][Û˜
KğìÈ^\İX[HÚ\Â˜Ø[Z[šÜÈ8 %HPHİYÙ\š\ˆ[ÛÈ]]ÛX]XØ[Y[H
ğìÈÛØœ™H[İ[œÈØ\ÛÜÊHİKœÙHİ]™\ÜÙHpî›\\È™YÚpíY\È]XİY\Ë•\Ø\ˆ\İH™YÚpèÛÈˆÜ‚œ™YÚpèÛÈ
™]šY]ËŞ›İ0èÛÈ°èH^\İ[JKˆ°èÛÈ^\İXH™[š[H˜[˜XÚÂœ›ÈØ\ÛÈXZ\ÈÚ[\\Îˆ›°èÛÈÛÛ™š[È[H˜YH\ÜÛË0êHğìÈ[XHX™[Bœ[˜H‹ˆÛÛ\]Xš[]S[ÙTÙ[Xİ[Û˜
Ü˜ËÛX‹Ú[\Ü]ÛÜšØ™[˜ÚØ
H0êBœ\˜[Y[H\İ]\˜[8 %XÚHHš[YZ\˜H[šHHÜ˜YHÜšYÚ[˜[ŠÛİ\˜ÙQÜšY
HÛÛH]X[]Y\ˆYË\ØHÛÛ[ÈØX™péØ[ËHÙÈÈ™\İÈB™Ü˜YHÛÛ[ÈYËÙ[H™[š[XH[]]˜HH[\ˆ0ë][ÜÈY\ØÛYÜÈİB˜Y]š[š\ˆÙ[pè›XØH
Øİ[Y[YÈ›È°ìÜš[ÈÛÛY[0è\š[ÈH[°éğèÛÎˆ0êBˆ˜\œ›ÈˆH›Ü0ìÜÚ]Ë0êHÈ0î›[[È™Xİ\œÛÊKˆ[ÛHÈY\Û[È›Ü›X]ÈB˜[\ÜÙ[Xİ[Û˜ØÛİ\˜ÙTÙ[Xİ[Û˜]YHÈ›İ0èÛÈ•\Ø\ˆ\İH™YÚpèÛÈˆ°èB›[ÛHX[X[Y[H8 %Ü[[™ÈÙ]Ù[Xİ[Û˜Ù[H\XØ\ˆÛŞš[šÎÈÂ\İpè\š[È™]š\ØH˜H˜[˜ØYHH[\ÜpéğèÛÈ
]YH°èH]YH˜H[ÙÈ”Ù[XÚ[Û˜\‚›˜HÜ˜YHÜšYÚ[˜[ˆ]]ÛX]XØ[Y[JHHÛXØH\XØ\ˆÙ[péğèÛÈˆÛÛ[ÂœÙ[\™Kˆ™\›È\İYÈ›İ›Ë™\›È[™œ˜Y\İ]\˜H›İ˜K‚‚”Z[™[›İ›È[H™]šY]ËŞš\ğë]™[]X[™È™YYĞÛÛ™š\›X][Ûˆ	‰‚˜Xİ]™OËœÛİ\˜ÙQÜšYÙÛÈ\0ìÜÈÈZ[™[HØ\›š[™ÜÈ^\İ[K‚‚•™\šYšXØYÈ[Èš]›ÈÛÛHÚ\ÈÛÜšØ›ÛÚÜÈÚ[0ê]XÛÜÎˆ[HÛÛH™YÚpíY\Âİ[Y[HÙ\\˜Y\ÈÜˆÛÛ[˜H˜^šXH
]]Ë\Ü]È[\ÜØ°èBœ™\ÛÛ™H\ÜÛÈÛŞš[šËZ[™[HÛÛ\]Xš[YYH°èÛÈ\\™XÙH8 %ÛÛ™š\›XBœ]YHÈØ]H™YYĞÛÛ™š\›X][Û˜\İ0èHÛÜœ™]ÊHHİ]›ÈÛÛH[š\ÈB˜ÛÛYÙ[HHÛÛ[˜H\œ™Yİ[\ˆÙ[H™[š[XH[šHÛ\˜[Y[H^X[ŠØX™péØ[È]XİYÈH	HHÛÛ™šX[°éØJH8 %Z[™[\\™XÙKÛ\]YB›ØØHH˜[˜ØYH˜H”Ù[XÚ[Û˜\ˆ˜HÜ˜YHÜšYÚ[˜[ˆÛÛHØX™péØ[È˜B›[šHHHYÜÈ˜\È[š\ÈÙYİZ[\Ë^][Y[HÛÛ[Â˜ÛÛ\]Xš[]S[ÙTÙ[Xİ[Û˜Ø[İ[NÈ\XØ\ˆÙ[péğèÛÈˆ\Ú\È\ÜÛÂ›°èÛÈ]YXœ˜H˜YKˆXYÛ°ìÜİXÛÈ˜Z^0è]™[™\šYšXØYÈ[\˜Ù\[™Â˜T“˜Ü™X]SØš™XİT“›È˜]™YØYÜˆ™X[ˆ”ÓÓˆHKHĞ‹Ù[H˜\ÙM››ÈÛÛpî™ËÛÛHÜÈØ[\ÜÈ\Ü\˜YÜË‚‚˜œš]\İ[˜
MÌˆ\ÜÛİKH[YÈ8 %H\İ\È›İ›ÜÊKœØÂ‹K[›Ñ[Z]œ\Û[›ÜÈH\œ]Z]›ÜÈØØYÜÈ
Ô“ˆ›Ü›X[^˜YÈ[\Ë˜\›XY[HÛÛšXÚYJKœH[ˆZ[
ÈœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØŠ™\›È™YÜ™\ÜğèÛÈHÜ°éØ[Y[ÊH\›İ˜YÜË‚‚ˆÈÈLKˆ™]š\ğèÛÈHXZ\ÈœÈÈ\[™X›İˆ›ÙH™XXİY^K\XÚÙ\ˆLY\ØÛY\ËÜ\È\Û[L™XÚYÈÜˆ™YÜ™\ÜğèÛÈ™X[H\™›Ü›X[˜ÙH
°èÛÈ[˜ÛÛ\]Xš[YYJB‚ÛÛ[XpéğèÛÈHÙpéğèÛÈLKÌLËˆ›Ù
ø¡¤ˆÌMŒÊHH™XXİY^K\XÚÙ\˜Šx¡¤ŒLˆÌMŒ
HY\ØÛY\È\Ú\ÈHÛÛ™š\›X\ˆ]YH™[š[HÜÈÚ\È0êB\ØYÈH˜]È›ÈğìÙYÛËY›ÛH
›Ù0êH\[™0ê›˜ÚXH\™]H0ìÜ™°èÈ8 %ğìÂ\ØYÈ˜[œÚ]]˜[Y[HÜˆÛÚÙ›Ü›KÜ™\ÛÛ™\œØÕ[”İXÚÈ[\›˜[Y[NÂ˜™XXİY^K\XÚÙ\˜ØØ[[™\˜0êHØØY™›Û[™ÈÈÚYÛ‹İZH[˜ØBš[\ÜYÈÜˆ™[š[XH›İJH8 %š\ØÛÈH™YÜ™\ÜğèÛÈ\ÜÙ[˜ÚX[Y[H™\›Ë›X\È\İYÈHY\ÛXH›Ü›XHšYÛÜ›ÜØHY\Û[È\ÜÚ[KˆXÚYÈ™X[˜HˆÂ˜™XXİY^K\XÚÙ\˜ˆHŒL™[›ÛY[İHHÚ]™HX›XÈRX[[H˜B˜[ÛÙÜšY8 %ØØYÛİHÈ\œ›ÈH\È[HØ[[™\‹ŞÛÜœšYÚYÂ˜ÛÛ[È\HÈY\™ÙH
ZYÜ˜péğèÛÈ™X[°èÛÈØ[XšX\œ˜JKˆ[X˜\È\ÈœÂ]™\˜[HÈY\Û[È›Ø›[XH™XÛÜœ™[HHØÚÙš[H›Ü˜HHÚ[˜Ü›ÛšXB™Ù\˜YÈ[È\[™X›İ
KXØXÚX]X\H™^ˆ™\İHÙ\ÜğèÛÊK˜ÛÜœšYÚYÈÈY\Û[È™Z]ÈHÙ[\™K‚‚˜XÚYK\™XXİ
8¡¤ŒKˆÌMÊH[X°ê[HY\ØÛYH8 %ğìÈ0ëXÛÛ™\Â˜YXÚ[Û˜YÜÈ[™HMÍHHKŒÌK™[š[XH]Y[°éØHHTH]YHY™]\ÜÙHÂœ›Ú™]È
[\ÜÈ›ÛYXYÜÈÛÛ[X[H™\ÛÛ™[™ÊKˆØÚÙš[H[X°ê[Bœ™XÚ\ÛİHHY\ÛXHÛÜœ™péğèÛË‚‚˜\\ËÛ›ÙX
Œ¸¡¤Œ‹ˆÌM
NˆÛÛ™š\›XYÈH›İ›È
ÒH›ÙB˜›ÙK]™\œÚ[ÛˆŒ˜^0ëXÚ]È[HÙÜÈÜÈ›ØœÈB˜™Ú]X‹İÛÜšÙ›İÜËØ\XØ][Û‹[[È›ÙpéğèÛÈ™\˜Ù[\ØB˜›ÙZœÌ
H]YHH™\œğèÛÈˆšXØH0èœ™[HÜÈÚ\È[XšY[\È™XZ\È8 %˜ÛÛY[YÈHZ^YÈX™\ËÙ[HYÛ›Ü™X
°èÛÈ0êH™Z™ZpéğèÛÈ\›X[™[JK‚‚ŠŠ‘Ü\È\Û[
\Û[LŒH
È\Û[ÚœÈLŒŒH
ÈÛØ˜[ÈMËŒLKŒ”œÈÌMŒ‹ÈÌM‹ÈÌMŒJJŠˆXÚYÈ[HX\È]\\Ë‚‚ŒKˆš[YZ\˜H[]]˜HHY\™ÙH\È°êœÈ[\ÎˆœHÚX˜[HÛÛBˆT‘TÓÓ‘H™X[8 %\Û[\YÚ[‹\™XXİZÛÚÜĞKŒ‹Œ
™\œğèÛÈ]X[Âˆ›Ú™]ÊHğìÈXÛ\˜Hİ\ÜHH\Û[]0êHKŒŒÛÛ[ÈY\‹‚ˆÛÛY[YÈ˜\È°êœÈœËZ^Y\ÈX™\\È
›Ü]YZ[È™\ÛÛ0î™[[ÂˆÛÛ°è\š[ÈÈØ\ÛÈÈ\TØÜš\È˜HÙpéğèÛÈLJK‚Œ‹ˆ[™\İYØpéğèÛÈH\Ø›Ü]YZ[Îˆ\Û[\YÚ[‹\™XXİZÛÚÜĞËŒKŒX°èBˆXÛ\˜Hİ\ÜHH\Û[ŒLŒŒ8 %[œİ[HÙ[HÛÛ™›]ËˆX\ÈÂˆ[ÛÛ\]ÈÈ™\È
\Û[˜
K]YH›ÙH[H
ŠŒNKÊŠˆ˜HXZ[˜ˆÜšYÚ[˜[
YYYÈ[XHÚ]ÛÜšİ™YXÙ\\˜YKÛÛ[È[šHH˜\ÙJKˆ\ÜÛİHH
ŠŒLZ[]ÜÈÙ[H\›Z[˜\ŠŠˆÛÛHÈÛÛX›È\Û[L
Âˆ™XXİZÛÚÜÈËŒKŒH8 %ÛÛ™š\›XYÈ]YH°èÛÈ\˜H˜]˜[Y[È
›ØÙ\ÜÛÂˆ›ÙXÛÛHÔH]]˜HŒL	HH[HÛÜ™HÈ[\È[Z\›Ë°èÛÂˆXYØÚËĞÔH™\˜YJHšXHÙ]T›ØÙ\ÜØ›ÈİÙ\”Ú[ˆ\ÛÛYÈÜ‚ˆ\™]0ìÜš[È
Ü˜ËÛX‹ØÜ˜ËØÛÛ\Û™[ËÛÛX[KØˆÜ˜ËÜ›İ]\ËÚ[™^Ş[™]šYX[Y[H8 %ÙÜÈ°è\YÜËMNLÊH°èÛÂˆ™\›Ù^š]HÈ›Ø›[XNÈğìÈÈ\Û[˜È™\È[Z\›È[È˜]˜Bˆ[Ëˆİ\ÜZ]Nˆ\È™YÜ˜\ÈH[°è[\ÙH”™XXİÛÛ\[\ˆˆ]YHÂˆ\Û[\YÚ[‹\™XXİZÛÚÜØ\ÜÛİHH[˜ÛZ\ˆÜˆY°èÛÈH\\ˆBˆˆ˜^™[H[™™\°ê›˜ÚXHXZ\È\ØYH
ÜÜÚ]™[Y[HÛÛHİ\İÈ°èÛË[[™X\‚ˆ›È[X[šÈÈ›Ú™]ÊH]YHHH[˜ØH]™K‚‚‘XÚ\ğèÛÎˆ
Š˜\È°êœÈœÈÈÜ\È\Û[›Ü˜[H™XÚY\ÊŠˆ
°èÛÈY\ØÛY\Ë›°èÛÈğìÈ[H\[™X›İYÛ›Ü™X
H8 %[H[HL
ÈZ[]ÜÈ[šXXš[^˜\šXB˜HÒKˆY™\™[HH™Z™ZpéğèÛÈÈ\TØÜš\È
[˜ÛÛ\]Xš[YYB™\İ]\˜[\›X[™[JK\]ZHHÛÛXš[˜péğèÛÈXÛšXØ[Y[H[œİ[HB™[˜Ú[Û˜KğìÈ0êH[H[XZ\È˜H\Ø\‹ˆ™]š\Ú]\ˆÙHÂ˜\Û[\YÚ[‹\™XXİZÛÚÜØ[°éØ\ˆ[XH™\œğèÛÈ]YH™\ÛÛ˜H\ÜØB›[Y0èÛËİHÙHİ\™Ú\ˆ[XH›Ü›XHHX[\ˆ\È™YÜ˜\ÈHÛÚÜÂ™\ÜÙ[˜ÚXZ\ÈÙ[H\™\ˆ\È›İ˜\È™YÜ˜\È\ØY\ÈÈ™XÛÛ[Y[™Y‚‚˜œš]\İ[˜œØÈK[›Ñ[Z]œH[ˆZ[
Â˜œH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÜÈ˜\ÈX\ÈœÈY\ØÛY\È
›Ùœ™XXİY^K\XÚÙ\ŠH[\ÈÈY\™ÙNÈXÚYK\™XXİ[X°ê[H\ÜÛİH[B›Y\ÛXH˜]\šXH[\ÈÈY\™ÙK‚‚ˆÈÈLLˆÛÜœ™péğèÛÈÈÛÛ\H˜\œ˜KÜHİ™\ˆ[H˜\œ˜KÜ^˜KÛİÈ›È˜[šÚ[™ËH›İ›ÈÚYÙ]”˜Y\ˆ‚‚•\İpè\š[ÈÛÛİHÈğìÙYÛÈH[HÛÛ\Û™[HH^[\È
™[È\Ú›Ø\™‹™œ˜[Y\‹[[İ[Û‹š\İX[œ][\İJHHY]H°êœÈÛÚ\Ø\ËXÚYY\ÈÜ‚œ\™İ[\ÈH\ØÛ\™XÚ[Y[È[\ÈH[\[Y[\ˆ
JH]˜\ˆÂŠ™\Ü0ë\š]ÊˆH[š[XpéğèÛËÚİ™\ˆÈ^[\È›ÜÈÚYÙ]ÈH˜[šÚ[™ËØ˜\œ˜KÂœ^˜H°èH^\İ[\ËÙ[HYİ\ˆœ˜[Y\‹[[İ[Ûˆ™[HÈš\İX[œ][\İBŠY\ÛXHXÚ\ğèÛÈHÙpéğèÛÈLÊNÈ
ŠHÛÜœšYÚ\ˆÈÛÛ\ÈÜ°èYšXÛÈB˜˜\œ˜\Ë]YH\\™XÚXH[H]X[]Y\ˆÛÈHÛÛ[˜HHØ]YÛÜšXK°èÛÈğìÂœÛØœ™HH˜\œ˜NÈ
ÊHYXÚ[Û˜\ˆÈÜ°èYšXÛÈœ˜Y\‹Üİ]ÈˆÈ^[\ÈÛÛ[Â\ÈHÚYÙ]H™\™YKÛÛHYÜÈ™XZ\ËÈ[X[šÈH^˜K‚‚ŠŠ•ÛÛ\H˜\œ˜JŠˆØ]\ØH˜Z^ˆÛÛ™š\›XYH[™Â˜›ÙWÛ[Ù[\ËÜ™XÚ\ËÙ\Í‹ØØ\\ÚX[‹Ğ˜\‹šœØ8 %ÈÛÛ\İ\œÛÜ^Ë‹‹ŸO˜™È™XÚ\È˜\İ™ZXHHÜÚpéğèÛÈÈ[İ\ÙHH]]˜H˜HÙHH˜Z^HB˜Ø]YÛÜšXH
Z^ÊK[™\[™[HH[\˜H™X[H˜\œ˜Kˆ[H\˜[[È°èB™^\İXHXİ]™P˜\’[™^Ù]YÈšXHÛ“[İ\ÙQ[\˜ØÛ“[İ\ÙSX]™XÂœ°ìÜš[È˜\˜8 %]YHÈ™XÚ\È\Ü\˜HÜˆ˜\œ˜H™X[™[™\š^˜YBŠ[™\ˆ™XÙX™H
]K[™^]™[
XYXØ[š\Û[ÈXZ\È™XÚ\ÛÊK‚ÛÜœ™péğèÛÎˆİ\œÛÜ^Ù˜[Ù_X
™[[İ™HÈ™]0è›™İ[ÈH[™È]YH[]˜HB˜ÛÛ[˜H[Z\˜JH
ÈÛÛ[ÈÚ\ÛÛ\˜YÛÜ˜HğìÈ™[™\š^˜B˜˜\•ÛÛ\˜]X[™ÈXİ]™P˜\’[™^OOH[ˆ™[š[XH]Y[°éØH[B˜]XØ˜\”Ù\šY\ØØ\Ğ[š[X][ÛXİ]™X8 %š\ØÛÈ™\›ÈH™Z[›Ù^š\ˆÂ˜YÈH›XÚÙ\ˆÈZ^ÈH
ÙpéğèÛÈ
Kˆ™\šYšXØYÈ[Èš]›È\ÜXÚ[™Â™]™[ÜÈH[İ\ÙHÚ[0ê]XÛÜÈ\™]È›È[[Y[ÈH˜\œ˜H
°èÛÈ›Â˜[[Y[œ›ÛTÚ[H[XHÛÛÜ™[˜YK]YH\]ZH°èÛÈ]˜]™\ÜØHÈÕ‘ÈÜ‚˜[İ[XHXİ[X\šYYHH^[İ]°èÛÈ[™\İYØYJNˆÛØœ™HH˜\œ˜KÂÛÛ\[Üİ˜H”]X\H‰[šHÈÈ^Ù[8¡¤ÈL‰HÈ›È\ÜpéÛÈ˜^š[Â™HY\ÛXHÛÛ[˜H
XÚ[XHH˜\œ˜Hİ\JKÈÛÛ[™]Ü›˜H˜^š[Ë‚‚ŠŠ”ÜHİ™\ˆ[H˜\œ˜HH^˜JŠˆ˜\œ˜HØ[šİHİ›ÚÙXØİ›ÚÙUÚY˜ÛÛ™XÚ[Û˜Z\È›ÈÙ[˜°èH^\İ[H
Y\Û[ÈY°èÛÈÈÙ[˜Bœ^˜JKˆ^˜HØ[šİHXİ]™TÚ\X˜]]›ÈÈ™XÚ\È
ÙXİÜ˜ÛÛB˜İ]\”˜Y]\Ø
Íˆ˜H˜]XH]]˜JH8 %Ù[H\İYÈ›İ›Ë™X\›İ™Z]B˜\Ü^YYYR[™^]YH°èH^\İXKˆ™\šYšXØYÈ[Èš]›Îˆ˜Z[ÈÈÙ]Ü‚œÛØˆÈ[İ\ÙH›ÚHHÌKŒˆ˜HÍËŒˆ
È
Íˆ\Ü\˜YÊH[È\ÜXÚ\ˆ]™[ÜÂ™H[İ\ÙH›È[[Y[È™X[‚‚ŠŠ‘ÛİÈHİ™\ˆ›È˜[šÚ[™ËØ]˜[XpéğèÛËÜÚYX˜\ŠŠˆ›ÛX[K\˜[šÚ[™ËYš[Š™X\›İ™Z]YH[ÜÈÈYØ\™\È\ÙHHÙpéğèÛÈLÊHØ[šİB˜š[\ˆœšYÚ™\ÜÊKŒLŠX
È[È
›Ş\ÚYİØ
H›Èšİ™\˜Ù[HY^\‚™[H[\˜KØ˜[œÙ›Ü›NˆØØ[X8 %H˜XÚÈ[Hİ™\™›İÎˆY[˜H[\˜B™š^H
Ü
KÜ™\ØÙ\šXHÛÜYKˆ\ÛYØYÈ[X°ê[H[B˜™Y™\œË\™YXÙY[[İ[Ûˆ™YXÙXY\Û[ÈY°èÛÈ°èH\ØYÈ›È\œ]Z]›Ë‚ŠŠ“°èÛÈ™\šYšXØYÈ[\˜]]˜[Y[JŠˆšİ™\˜0êH\İYÈ˜]]›ÈÂ›˜]™YØYÜ‹°èÛÈ\Ü\°è]™[Üˆ]™[ÈH[İ\ÙHÚ[0ê]XÛÈ
Y™\™[HÂ˜Û“[İ\ÙQ[\˜È™XXİ]YH™\ÜÛ™HH]X[]Y\ˆ[İ\ÙQ]™[™\ÜXÚYÊH8 %H\İHØ[™›Ş°èÛÈÛÛœÙYİYH\˜\ˆØÜ™Y[œÚİÛ[İ™\ˆÂ›[İ\ÙHH™\™YH
[™H°èÛÈÛÛ\0íYHœ˜[Y\È[HÙYİ[™È[›ËY\ÛXB›[Z]péğèÛÈ°èHØİ[Y[YH˜HQ‹ÜØÜ™Y[œÚİ
KˆÛÛ™š\›XYÈ\[˜\È]YHBœ™YÜ˜HÔÔÈÛÛ\[İHÛÜœ™][Y[H›Èİ[\ÚY]Ù\šYÈ
œšYÚ™\ÜÊKŒLŠXœ™\Ù[JHH]YHHÚ[^H0êHY0ê›XØH[È›ÛX[K\˜[šÚ[™Ë\›İÎšİ™\˜°èB˜ÛÛ\›İ˜YÈ[˜Ú[Û˜[™Ë‚‚ŠŠ“›İ›ÈÚYÙ]”˜Y\ˆŠŠˆY\ÛXHÙ[pè›XØHÈ˜[šÚ[™È
Ü›İ\Ù^X˜Ø]YğìÜšXØH
È˜[YRÙ^X[pê\šXØH
ÈÜÜÜ˜ÛÛ[ÈZ^ÜËY°èÛÂJK™X\›İ™Z][™ÈÚ\Ù\šY\Ø\™][Y[H8 %™[š[XHYÜ™YØpéğèÛÈ›İ˜K‚”™[™\š^˜péğèÛÈL	H™XÚ\È˜]]›È
˜Y\Ú\ØÛ\‘ÜšYÂ˜Û\[™ÛP^\ØØÛ\”˜Y]\Ğ^\ØØ˜Y\˜
KÛÜ™\ÈšXH˜\špè]™Z\ÈÔÔÈ°èB\ØY\È[Hİ]›ÜÈÜ°èYšXÛÜËˆ\œ]Z]›È°ìÜš[Â˜Ü˜ËØÛÛ\Û™[ËÛÛX[KÜ˜Y\‹]ÚYÙ]X›ÙKŞ
°èÛÈ[[ÛØYÈ[B˜Ú\]ÚYÙ]X›ÙKŞ]YH°èH0êHÜ˜[™HHğìÈYÜ\H˜\‹ÜYKÛ[™KØ\™XBœÜˆÛÛ\\[\™[H\İYÈ8 %˜Y\ˆ°èÛÈÛÛ\\[H˜YHÛÛH[\ÊK‚”™YÚ\İ˜YÈ›ÜÈˆÛÜÈÈÚXÚÛ\İHÙpéğèÛÈÎˆ\\ËØ
[špèÛÈ
Â˜ÚYÙ]\SX™[Ø
KÚYÙ]\İ\ÜŞŠÚYÙ]\Q\ØÜš\[ÛœØ
ØÚYÙ]XÚÙ\’XÛÛ˜0ëXÛÛ™H˜Y\˜Â›XÚYK\™XXİ
KÚYÙ]ËØ
Y˜][Ü[˜ØY˜][Ú^™X˜HY\ÛXB˜ÛÛ™péğèÛÈHœYH˜
Èœ˜[˜ÚHÜ™X]UÚYÙ]
KÚYÙ]XØ\™ŞŠ\Ü]Ú\ŠK›İ]\ËÚ[™^Ş
Ø[YY\ÛXHÛÛ™péğèÛÈHYX
K‚“Y\ÛXHXÚ\ğèÛÈHÙpéğèÛÈÎˆ
Š›°èÛÊŠˆ[˜H˜H™XÛÛY[™péğèÛÈ]]Ûpè]XØBŠ]]ËY\Ú›Ø\™Ø°èÛÈ›ÚHØØYÊKğìÈ\\™XÙH›ÈÙ[]ÜˆX[X[ˆYXÚ[Û˜\ˆÚYÙ]‹‚‚•™\šYšXØYÈ[Èš]›È
YÜÈÛÛYÜËØ]YÛÜšXH”]X\HˆÛÛH˜[Üˆ™[B›Y[›Üˆ]YH\Èİ]˜\È˜H›Ü°éØ\ˆ[XH˜\œ˜Hİ\JNˆÈ][HÈÙ[]Ü‚ˆ•ÚYÙ]ˆ™XÚ\ÛİHÈY\Û[ÈÛÛÜ››È°èHØİ[Y[YÈ˜H›ÜİÛ“Y[X™È˜Y^
˜ÛXÚÊ
XÚ[0ê]XÛÈ°èÛÈXœ™HÈY[NÈÙ\]pê›˜ÚXB˜Ú[\™İÛ˜ØÚ[\\ØÛXÚØ\ÜXÚYHšXH\Ü]Ú]™[Ú[JB¸ %‘Ü°èYšXÛÈ˜Y\ˆˆ\\™XÙH˜H\İKÚYÙ]ÜšXYÈÛÛH0ë][È”˜Y\ˆ0­Â”ÛÛXHH˜[ÜˆÜˆØ]YÛÜšXHˆ
YÜÈ™XZ\ÊKÛ\ÜÙB˜Î˜ÛÛ\Ü[‹LHZ[‹ZN
Y0ê›XØH0èH^˜JKZ^ÜÈ[Üİ˜[™È\ÈB›XZ[Ü™\ÈØ]YÛÜšX\ÈÛÜœ™]\ËÛ0ëYÛÛ›ÈÈ˜Y\ˆ™[™\š^˜YËˆ™\›È\œ›Â››ÈÛÛœÛÛK‚‚˜œš]\İ[˜
MÌˆ\ÜÛİKH[YÈ8 %Y\ÛXHÛÛYÙ[K™[š[XB™[°éğèÛÈ\˜H›İ˜JKœØÈK[›Ñ[Z]œ\Û[›ÜÈÈ\œ]Z]›ÜÂØØYÜÈ
ğìÈ]š\ÛÜÈ°êKY^\İ[\ÈH™XXİ\™Yœ™\ÚÛÛ›KY^ÜXÛÛ\Û™[Ø›°èÛÈ™[XÚ[Û˜YÜÊKœH[ˆZ[
ÈœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØŠ™XÚ\Ë]™[™ÜˆİXš]HHÈ˜HNÚPˆ[È˜Y\Ú\›İ›Ë›Ü°éØ[Y[ÈÛÛ[XH\›İ˜YÊH\›İ˜YÜË‚‚ˆÈÈLLKˆYÈ™X[™\ÜYÈ[È\İpè\š[ÎˆZ^ÜÈ\XØYÜÈ›ÈÚYÙ]˜Y\ˆ
\™İH[ÙÈ›[šHH[šHˆÈY°èÛÈH˜[šÚ[™ËØ˜\œ˜JB‚•\İpè\š[È™\ÜİH
ÛÛHØÜ™Y[œÚİ
H]YH[HÚYÙ]˜Y\ˆ™Xğê[KXÜšXYÂ›[Üİ˜]˜HZ^ÜÈ™\]YÜÈ
“X[š0èÈˆŞ•\™Hˆ“›Ú]HˆŞŠHH™[š[BœÛ0ëYÛÛ›Èš\ğë]™[8 %YÜ\[™ÈÜˆ•\››Èˆ
ğìÈÈ˜[Ü™\ÈÜÜğë]™Z\ÊHB˜YÜ™YØ[™È[[Üİ˜\È‹‚‚ŠŠØ]\ØH˜Z^ŠŠˆ]S[ÙX[H˜Y\‹]ÚYÙ]X›ÙKŞ›ÚHÛÜXYÂ™\˜˜][HÈY°èÛÈH˜[šÚ[™Ë]ÚYÙ]X›ÙKŞ
ÙpéğèÛÈLL
N‚˜Ë™]S[ÙHÏÈ
ÜOOH˜Ûİ[ˆÈ˜YÙÜ™YØ]Hˆˆœ˜]ÈŠXˆ˜Bœ˜[šÚ[™ËØ˜\œ˜K[ÙÈ›[šHH[šHˆ
˜]ÊH˜^ˆÙ[YÈ8 %ØYH[šHš\˜B[XHX\˜ØH°ìÜšXKY\Û[È™\][™ÈÈ›ÛYHHØ]YÛÜšXKˆ˜H˜Y\‹›°èÛÎˆÈZ^ÈÈÛ0ëYÛÛ›È0êHÜÚXÚ[Û˜[
Û\[™ÛP^\Ø
K[XHÜÚpéğèÛÂœÜˆØ]YÛÜšXH8 %[H[ÙÈ˜]ËØYHS’HH[š[Hš\˜]˜H[HZ^ÂœÙ\\˜YËH[š\ÈÛÛHÈY\Û[È˜[ÜˆHØ]YÛÜšXH
ÈØ\ÛÈ›Ü›X[°èBœ]YH•\››ÈˆğìÈ[HÈ˜[Ü™\ÈÜÜğë]™Z\È˜H°è\šX\È[š\ÊHÙ\˜]˜[HZ^ÜÂ˜ÛÛHÈY\Û[È°ìİ[È[HÜÚpéğíY\ÈY™\™[\ÈÈğë\˜İ[ËÙ[H™[š[B˜YÜ™YØYÈ™X[8 %ÈÛ0ëYÛÛ›È™\İ[[H\˜HYÙ[™\˜YËÜÙ[HÙ[YË‚‚ŠŠÛÜœ™péğèÛÊŠˆ˜Y\ˆYÛÜ˜HÙ[\™H\ØH]S[ÙNˆ˜YÙÜ™YØ]H˜ŠÛÛœİ[KYÛ›Ü˜HË™]S[ÙX
H8 %[˜ØHÙ™\™XÙH™[H\™H[ÙÈ˜]Ë‚”™[[İšYÈ[X°ê[H[İÔ˜]ØØÛ”˜]ØÈØ[İ[][Û]Û˜È˜Y\ˆ
B›Ü0éğèÛÈH›ØØ\ˆ˜H›[šHH[šHˆ™[H\\™XÙHXZ\È˜HRJKˆÚYÙ]Âœ˜Y\ˆ°èHØ[›ÜÈÛÛH]S[ÙNˆœ˜]È˜HÙ\ÜğíY\È[\š[Ü™\ÈÙB˜]]ØÛÜœšYÙ[H›È°ìŞ[[È™[™\‹Ù[H™XÚ\Ø\ˆHZYÜ˜péğèÛÈ8 %ÈØ[\È0êBœÚ[\\ÛY[HYÛ›Ü˜YÈYÛÜ˜K‚‚•™\šYšXØYÈ[Èš]›È™\›Ù^š[™ÈÈÙ[°è\š[È^]ÈÈ\İpè\š[È
\››ÈÛÛB˜[Ü™\È™\]YÜÈ
È[[Üİ˜\È[pê\šXØJNˆZ^ÜÈYÛÜ˜H[Üİ˜[B˜È•\™H‹“X[šH‹“›Ú]H—X
0î›šXÛÜÊKÛ0ëYÛÛ›È™[™\š^˜HÛÛH˜[Ü™\Âœ™XZ\È
˜Y\ˆ0­ÈpêYXHH[[Üİ˜\ÈÜˆ\››ØÜ\˜péğèÛÈ›pêYXH‚˜]]ËY\ØÛÛYJKˆœš]\İ[˜
MÌˆ\ÜÛİKH[YÊKœØÂ‹K[›Ñ[Z]œ\Û[›È\œ]Z]›ÈØØYÈ\›İ˜YÜË‚‚ˆÈÈLL‹ˆ°êœÈXÚYÜÈ™XZ\È›ÈÚYÙ]˜Y\ˆpê]šXØHY°èÛÈÙ[HÙ[YËÜ0éğèÛÈH‘Z^ÜÈˆÙ[HY™Z]ËH˜[HHİ™\‹Ûpê]šXØ\ÈÛÛ[È^˜KØ˜\œ˜B‚•\İpè\š[È\İİHÈÚYÙ]˜Y\ˆ
ÙpéğèÛÈLLÌLLJHÛÛHYÜÈ™XZ\ÈH›İ^B°êœÈ›Ø›[X\ÈÛÛ˜Ü™]ÜË[HÜˆ™^‹ØYH[HÛÛHXÚYÈ™X[Üˆ°è\ÂŠ™[š[H\˜H›ÈÙ[]Üˆ°èÛÈ[˜Ú[Û˜Hˆ8 %Hİ\ÜZ]H[šXÚX[HÙpéğèÛÈLL™›ÚH\ØØ\YHÜˆ\İH[Èš]›ÎˆÙ[Xİ˜Ù[\™H™\ÜÛ™]B˜ÛÜœ™][Y[HH]Y[°éØH™X[H˜[ÜŠK‚‚ŠŠŒKˆpê]šXØHY°èÛÈÙ[HÙ[YÈ[ÈÜšX\ˆÈÚYÙ]
Šˆ8 %[H˜Y\ˆ›İ›Â˜YÜ\[™È•\››Èˆ˜\ØÚXHÛÛ[™ÈÛÛ™›Ü›ZYYHˆ
™YÚ\İ›ÜÈÜ‚•\››Ø
KY\Û[È^\İ[™È[XHÛÛ[˜HÙ[Z[˜[Y[HÛÛpè]™[Š[[Üİ˜\ÈŠKˆØ]\ØH™X[ˆÜ™X]UÚYÙ]
ÚYÙ]ËØ
H\ØÛÛXB˜[\ÖÌX
š[YZ\˜HÛÛ[˜H[pê\šXØHÜˆÜÚpéğèÛÊHÙ[HÛÛœÚY\˜\ˆÙH[BœÛØœ™]š]™HÛÛ[Èpê]šXØHYÜ™Yğè]™[8 %HYÜ˜YpéğèÛÈ˜H˜ÛÛYÙ[H‚˜XÛÛXÚXHH™\™YKX\ÈğìÈ›È
œ™[™\Šˆ
Ù[X[XĞYÙÜ™YØ][Û“ÜØ\ØB›È\™š[Ù[pè›XÛÈHÛÛ[˜K^ˆYÙÜ™YØX›Nˆ˜[ÙX˜H[XHÛÛ[˜B\È^KÜØÛÜ™HˆY\Û[ÈÛÛHÚ[™ˆ›[X™\ˆ˜
KÜœ]YHÜ™X]UÚYÙ]›[˜ØH™XÙXšXH\ÜÙH\™š[ˆÛÜœšYÚYÈ™XY[™ÈÙ[X[XÔ›Ùš[\Ø˜]˜]°ê\ÈHÜ™X]UÚYÙ]
›İ›Èp®ˆ\°è›Y]›ÈÜÚ[Û˜[˜ÚY]š[[YÙ[˜ÙOË˜ÛÛ[[œØ›È0î›šXÛÈØ[Ú]H]YH[\ÜK˜\ÙK]ÚYÙ]XXİ[ÛœËØ
H8 %˜Y\ˆYÛÜ˜H™Y™\™HHš[YZ\˜HÛÛ[˜B›[pê\šXØH]YHÛØœ™]š]™HÛÛ[ÈÛÛXKÛpêYXHH™\™YKØZ[™È›ÈY°èÛÂ˜[YÛÈ
[\ÖÌX
HğìÈÙH™[š[XH]X[YšXØ\‹ˆ\İH›İ›È[B˜ÚYÙ]Ë\İØ™\›Ù^ˆÈÙ[°è\š[È^]È
ÛÛ[˜HÛÛ™›Ü›ZYYHˆÛÛB˜YÙÜ™YØX›Nˆ˜[ÙX[[Üİ˜\ÈˆØ]Y0è]™[
H8 %[\ÈÈš^˜[]˜BŠ\ØÛÛXHÛÛ™›Ü›ZYYJK\Ú\È\ÜØK‚‚ŠŠŒ‹ˆÜ0éğèÛÈ‘Z^ÜÎˆˆÙ[H™[š[HY™Z]Èš\ğë]™[
Šˆ8 %ÛÛHğìÈÈØ]YÛÜšX\ÂœÜÜğë]™Z\È˜HÛÛ[˜HHYÜ\[Y[Ë]X[]Y\ˆ˜[ÜˆH‘Z^ÜÈˆ8¢iLÂ™\Ù[šHÈY\Û[Èšpè›™İ[ËX\ÈH\İHš^HÌËKXÙ[\™B›Ù™\™XÚXH\È°êœÈÜ0éğíY\Ë\™XÙ[™È[HÙ[]Üˆ]YXœ˜YËˆÛÜœšYÚYÎ‚˜^\ÓÜ[ÛœØYÛÜ˜Hš[˜HH\İHš^HX[[™ÈğìÈ˜[Ü™\ÈİZ›Âœ™\İ[YÈ
™Y™]]›Êˆ
X]›Z[Š‹Ø]YÛÜšX\Ñ\ÜÛ°ë]™Z\ÊX
H0êHY™\™[B™È˜[Üˆ[\š[Üˆ8 %ÛÛHÈØ]YÛÜšX\ËğìÈŒÈˆ\\™XÙNÈÛÛKYØ[[ÜËˆŒÈˆHHˆ\\™XÙ[H
HÙYİ[™H°èH[Üİ˜HYÊHX\ÈˆÛÛYKÜœ]YB\šXHÈY\Û[ÈY™Z]ÈHH‹‚‚ŠŠŒËˆÙ[Hİ™\‹Ş›ÛÛKÛpê]šXØ\ÈÛÛ[È^˜HH˜\œ˜JŠˆ8 %YYÈ^0ëXÚ]ÈÂ\İpè\š[Îˆœ]Y\›È]YH\ÈÛ\ÈÈ˜Y\ˆY[H[H]™H›ÛÛHH[Üİ™[HÜÂ™YÜËYİX[H^˜H‹ˆ^˜KØ˜\œ˜H°èH[š[H\ÜÙHY°èÛÂŠXİ]™TÚ\XØÙ[ÛÛHÜXÚYYH
ÈÙ\šY\ĞÛÛ\\š\ÛÛ”[™[ÛÛB˜YPÛÛ\\š\ÛÛ‘›Ü˜[X›ÜÈÙ[°ê\šXÛÜÈÛØœ™HÛ˜[YKİ[V×X\ÙHBœÙpéğèÛÈÊH8 %˜Y\ˆ™X\›İ™Z]HÜÈÚ\ÈÙ[H™[š[XH0ìÙÚXØH›İ˜Nˆİ˜İ\İÛZ^˜YÈ›È˜Y\˜
ØYHÛH0êH[HÚ\˜ÛO˜ÛÛB˜Û“[İ\ÙQ[\˜ØÛ“[İ\ÙSX]™X°ìÜš[ÜË˜H8¡¤È›Èİ™\‹Y\ÛXB˜[œÚpéğèÛÈİXšXËX™^šY\ˆ°èH\ØYH[Hİ]›ÜÈYØ\™\ÊHB˜Ù\šY\ĞÛÛ\\š\ÛÛ”[™[X˜Z^ÈÈÜ°èYšXÛË\Ø[™ÈYPÛÛ\\š\ÛÛ‘›Ü˜œÛØœ™H^\ØˆÈÛÛXÚØ[YÛÈÈ˜Y\Ú\
˜\ÙXYÈ[B˜İ]K˜Xİ]™SX™[˜\İ™X[Y[ÈÜˆZ^È8 %Y\Û[ÈY°èÛÈ›Ø›[pè]XÛÂ™HÙpéğèÛÈLL›ÈÛÛ\H˜\œ˜JH›ÚH™[[İšYÎˆÈÛ\]YHYÛÜ˜Hš]™B››È°ìÜš[ÈÚ\˜ÛO˜HØYHÛK™XÚ\ÛÈÜˆ›Ü›XH™X[B›X[\ˆÜÈÚ\È[ÜÈØ]\Ø\šXH\ÈÙÙÛH
š[›ÈYØYÈ[Â˜Ú\˜ÛO˜\ÛYØYÈH›İ›È[ÈÛÛXÚØÈÚ\Ø[˜Ù[[™È[B˜[Èİ]›ÊK‚‚•™\šYšXØYÈ[Èš]›È™[[İ™[™ÈÜÈÚYÙ]ÈH\İH[YÛÜÈHÜšX[™È[B”˜Y\ˆÈ™\›Îˆ0ë][È˜\ØÙ]H˜Y\ˆ0­ÈpêYXHH[[Üİ˜\ÈÜˆ\››ØŠ°èÛÈXZ\ÈÛÛ™›Ü›ZYYKØÛÛYÙ[JNÈÙ[]ÜˆHZ^ÜÈ[Üİ›İHğìÈÈŒÈ—XÂšİ™\ˆ[HÚ\˜ÛO˜™X[ÛÛ™š\›[İH˜Z[È8¡¤ÈHÈZ[™[HÛÛ\\˜péğèÛÂ›ØØ[™È\˜HHØ]YÛÜšXHÛØˆÈ[İ\ÙH
“X[šK‹‹ˆ˜[ÜˆHX[šHL‹‹‚‘Y™\™[°éØH\˜H\™HNH0­ÈMË	H˜
Kˆ™\›È\œ›È›ÈÛÛœÛÛK‚‚˜œš]\İ[˜
MÌÈ\ÜÛİKH[YÈ8 %H\İH›İ›ÊKœØÂ‹K[›Ñ[Z]œ\Û[›ÜÈ\œ]Z]›ÜÈØØYÜÈ
Ô“ˆ›Ü›X[^˜YÂ˜[\ÊKœH[ˆZ[
ÈœH[ˆ\™›Ü›X[˜ÙN˜ÚXÚØ\›İ˜YÜË‚‚ˆÈÈLLËˆ[ÙÈH[™\İYØpéğèÛÈİZXYHÛÛ™XİH›İZ\›ËØ]\Ø\ÈH™YÚ\İ›ÜÂ‚“È›İZ\›È[˜[0ë]XÛÈØ[šİHHpéğèÛÈ[™\İYØ\˜˜\È\™İ[\È°èHÛØ™\\ÈÜ‚™Ü°èYšXÛËˆHpéğèÛÈXœ™H[XHZ]\˜HİZXYH[›ÈH°ìÜšXHš\ğèÛÈÙ\˜[Ù[B˜ÜšX\ˆ[XHÙYİ[™H[™İXYÙ[HH[°è[\ÙNˆ\ØHHpê]šXØHš[pè\šXKHY[Ü‚™[Y[œğèÛÈØ]YğìÜšXØKHÜ\˜péğèÛÈÙ[pè›XØH°èH™\ÛÛšYHHÜÈYÜÈ\Ú\ÈÜÂ™š[›ÜÈ]]›ÜË‚‚”]X[™È^\İ[H[ÈY[›ÜÈÚ\È\°ë[ÙÜÈ°è[YÜËZ[[™\İYØ][Û˜˜ÛÛ\\˜HÜÈÚ\ÈXZ\È™XÙ[\ÈHØ[İ[HHY™\™[°éØHHØYHØ]YÛÜšXKˆBœ\XÚ\péğèÛÈ0êHXœÊY™\™[°éØHHØ]YÛÜšXJHÈÛÛXJXœÊY™\™[°éØ\ÊJX°èÛÈ[XB™]š\ğèÛÈ[È[İš[Y[È0ë\]ZYËÜœ]YH][Y[ÜÈH™YpéğíY\ÈÙ[HÙHØ[˜Ù[\‹‚’\ÜÛÈ[X°ê[H\›Z]H˜[Ü™\È™YØ]]›ÜÈÙ[H]šXZ\ˆ[Ø[Y[ÈH™YğìØÚ[ËˆÙ[B™Ú\È\°ë[ÙÜËÈ[ÙÈXÛ\˜YÈ\ÜØHHÙ\ˆÛÛšXZpéğèÛÈ]X[H™[š[XB˜ÛÛ\\˜péğèÛÈ0êH[™[YK‚‚“ÈZ[™[[Üİ˜NˆÈ]YHXÛÛXÙ]K]X[™Ë\È°êœÈØ]YÛÜšX\È]YHXZ\Â›[İš[Y[\˜[HÈ™\İ[YË]0êHŒ™YÚ\İ›ÜÈHš\ğèÛÈ\ØYÜÈ˜H^XØpéğèÛÈH[Bœ°ìŞ[[È\ÜÛËˆÈ°ìŞ[[È\ÜÛÈ\ÛH\˜H\™]È]X[™È\ÈÛÛšXZpéğíY\È0ê›B[XH0î›šXØH\™péğèÛÈH\˜H˜\œ˜\È]X[™È0èH[İš[Y[ÜÈZ\İÜÎÈÈÚYÙ]0êHX™\ÂœÙH°èH^\İHİHÜšXYÈ[ÈÛÛ˜]ÈÈ›İZ\›ÈÙH\İ]™\ˆ˜[[™Ë‚‚“[Z]H[X™\˜YÎˆÜÈ™YÚ\İ›ÜÈ^XšYÜÈğèÛÈÜÈ™YÚ\İ›ÜÈHš\ğèÛÈš[˜YK˜ÛÛH0ë[™XÙHØØ[Hš\ğèÛËH°èÛÈ›ÛY][H[™\™péÛÈHğê[[HÜšYÚ[˜[ˆBœ›İ™[špê›˜ÚXHHğê[[HÛÛ[XH™\ÜÛœØXš[YYHÈÛİ\˜ÙT›İÜÔ[™[È[YÜ˜\‚›ÜÈÚ\È^YÙH\ÜØ\ˆÜÈY]YYÜÈHÜšYÙ[H]0êHHÚYX˜\ˆHšXØHÛÛ[È^[œğèÛÂœÜİ\š[Ü‹Ù[H[™[\ˆ°ë[˜İ[Ë‚‚ÛØ™\\˜HYXÚ[Û˜YH\˜H]Y[°éØH[™H\°ë[ÙÜË˜[˜XÚÈÙ[H]K˜[Ü™\Â›™YØ]]›ÜÈH›^È[Øš[HÛÛ\]ÈÛÛHX™\\˜HH[™\İYØpéğèÛÈH™YÚ\İ›ÜË‚