# Critérios de promoção do núcleo Rust/WASM

O núcleo Rust/WASM é o candidato padrão para **XLSX**. Ele materializa a
planilha a partir do próprio inventário e só assume a saída quando ela é
idêntica, ponta a ponta, à importação validada pelo leitor TypeScript. Contrato
incompatível, divergência ou falha acionam fallback automático.

## Amostragem

`VITE_WASM_SHADOW_SAMPLE_RATE` controla a parcela de arquivos OOXML medida, de
`0` a `1`. O padrão é `1`. A seleção usa uma assinatura determinística e efêmera
do nome, tamanho e extremidades do arquivo; nenhum desses dados é persistido pelo
motor. Arquivos não selecionados recebem o estado `sampled-out`.

## Gate padrão

O avaliador `assessWasmPromotion` exige simultaneamente:

- contrato de inventário `3.0.0` em todas as medições;
- pelo menos 25 arquivos efetivamente medidos;
- pelo menos 10.000 células comparadas;
- pelo menos 5 arquivos reais sanitizados por formato;
- zero falhas do adaptador;
- zero arquivos, abas, células ou estruturas divergentes;
- latência p95 do shadow mode de até 1.500 ms.

Estados `unavailable` e `sampled-out` não contam como arquivos medidos. O gate
retorna todos os motivos de bloqueio, em vez de apenas o primeiro.

## Corpus e decisão

O comando `npm run wasm:corpus` gera 25 planilhas determinísticas a partir de
`test-fixtures/wasm-corpus-manifest.json`, executa o binário WebAssembly
versionado e compara valores brutos, textos exibidos, fórmulas, mesclagens,
linhas ocultas e colunas ocultas com o inventário OOXML TypeScript. O relatório
JSON completo é salvo em `test-results/wasm-corpus-report.json` e publicado como
artefato da CI.

O corpus sintético cobre volume e recursos, mas não pode aprovar sozinho a
promoção. O campo `source` distingue `synthetic` de `sanitized-real`, e o gate
permanece bloqueado enquanto não houver cinco arquivos reais sanitizados para o
formato avaliado.

## Ativação e rollback

O caminho candidato está habilitado por padrão e, nesta fase, aceita somente
`xlsx`:

```dotenv
VITE_WASM_READER_MODE=candidate
VITE_WASM_CANDIDATE_FORMATS=xlsx
```

Sem variáveis, esses mesmos valores são assumidos. O modo candidato verifica
100% dos XLSX e registra `rust-wasm` somente quando o inventário Rust e a saída
final são equivalentes. Metadados complementares já validados, como filtros,
tabelas, comentários clássicos e links, são reconstruídos diretamente das
partes OOXML no workbook materializado. Eles não são mais copiados do workbook
SheetJS.

### Como desativar o candidato Rust (rollback)

`VITE_WASM_READER_MODE` e `VITE_WASM_CANDIDATE_FORMATS` são lidos via
`import.meta.env` em `configuredWasmReaderMode`/`configuredWasmCandidateFormats`
(`src/lib/workbook-reading-engine.ts`). O Vite substitui esses valores em tempo
de build — **não é um flag lido em tempo de execução**. Portanto o rollback:

1. **Não exige nenhuma mudança de código, PR ou revisão de lógica** — apenas a
   variável de ambiente muda.
2. **Ainda exige um novo build/deploy** para que o valor seja embutido no
   bundle publicado. Na Vercel, isso significa alterar
   `VITE_WASM_READER_MODE` para `shadow` nas variáveis de ambiente do projeto
   e disparar um redeploy (redeploy do último commit é suficiente; não é
   necessário nenhum commit novo).

Passo a passo:

```dotenv
VITE_WASM_READER_MODE=shadow
```

Depois do redeploy, todo XLSX volta a ser servido exclusivamente pelo leitor
TypeScript validado (`sheetjs-verified`/`ooxml-recovery`); o adaptador Rust,
se ainda estiver registrado no cliente, continua sendo executado e comparado
silenciosamente (`wasmShadowStatus`), mas nunca mais substitui a saída
(`wasmCandidateStatus: "shadow"`, `wasmOutputUsed: false`). Não há caminho de
código que materialize o resultado Rust fora do bloco `candidateEligible` em
`readWorkbookBytesWithEngine` (`src/lib/workbook-reader.ts`), então esse
único flag é suficiente para reverter a promoção — sem depender de reverter
commits, remover o pacote WASM ou desregistrar o adaptador.

Prova de regressão: `it("rollback: VITE_WASM_READER_MODE=shadow desativa o
candidato Rust mesmo quando ele seria promovido", …)` em
`src/lib/workbook-reader.test.ts` registra o mesmo adaptador Rust, com dados
que dariam paridade total, e confirma que apenas a troca de
`wasmReaderMode` (equivalente à variável de ambiente) já é suficiente para
reverter de `reader: "rust-wasm"` para `reader: "sheetjs-verified"`, mantendo
as linhas importadas idênticas e a medição de paridade (`wasmShadowStatus`)
ativa.

O procedimento local, suas garantias e seus limites estão em
`docs/WASM_CORPUS_SANITIZATION.md`. O comando `npm run corpus:sanitize` cria
cópias XLSX com nomes neutros em uma pasta ignorada pelo Git. Quando o destino é
`test-fixtures/sanitized-real`, `npm run wasm:corpus` incorpora automaticamente
essas medições ao relatório sem alterar o corpus público da CI.

Arquivos reais adicionais podem continuar no corpus local sanitizado. Esse
corpus ainda é obrigatório antes de remover a validação dupla e promover o Rust
para um caminho independente. Até lá, o leitor TypeScript permanece como oráculo
e fallback, priorizando fidelidade sobre ganho de desempenho.

## Outros formatos OOXML (Etapa 4)

O adaptador Rust já é acionado em shadow mode para XLSM, XLTX e XLTM, não só
XLSX (`shouldTryWasm` em `workbook-reading-engine.ts` aceita as quatro
extensões, porque todas compartilham a mesma estrutura ZIP/OOXML que o
inventário Rust já lê). Antes desta etapa, porém, o corpus determinístico
(`test-fixtures/wasm-corpus-manifest.json`) só continha perfis `xlsx` — os
outros três formatos nunca tinham sido medidos de propósito.

- **XLSM**: `scripts/generate-workbook-corpus.mjs` grava esse formato sem
  mudança nenhuma no script (SheetJS suporta `bookType: "xlsm"` no
  `XLSX.write`). Quatro perfis foram adicionados (`baseline-xlsm`,
  `formulas-xlsm`, `structure-xlsm`, `date-system-1904-xlsm`), no mesmo
  padrão de diversidade já usado para XLSX — 25 arquivos, mais de 10.000
  células.
- **XLTX e XLTM**: **não foi possível gerar sinteticamente.** O SheetJS
  instalado neste projeto só implementa `bookType` `"xlsx"`/`"xlsm"` no
  caminho de escrita (`XLSX.write`); tentar `"xltx"` lança
  `Error: Unrecognized bookType |xltx|`. Sem um gerador, esses dois formatos
  continuam sem nenhuma medição de corpus — nem sintética nem real. Avaliar
  a promoção deles exigiria arquivos `.xltx`/`.xltm` reais de origem (a
  mesma trilha de "arquivo real indisponível" que já bloqueia a promoção
  final do XLSX).

Medição original do corpus XLSM expandido (25 arquivos, ≥10.000 células):
**1 arquivo divergente em 12 células**, sempre a mesma causa — números em
formato "General" com muitas casas decimais (ex.: `111.03999999999999`)
eram exibidos pelo Rust como o valor bruto (`display_cell_value` só
arredondava os formatos explícitos `0`/`0.00`/`0%`/`0.00%`; fora deles
caía em `value.to_string()`), enquanto o SheetJS arredonda para exibição
como o Excel faz (`111.04`). O valor bruto (`rawValue`) sempre foi
idêntico nos dois leitores; só a representação exibida divergia. Essa era
a lacuna já registrada na seção 12 de `docs/CURRENT_STATE_AUDIT.md`
("exibição conservadora... sem inventar a renderização de formatos Excel
ainda não implementados") — o corpus original de XLSX não a expunha
porque suas sementes fixas não geravam esse padrão de ponto flutuante,
não porque XLSX fosse imune a ela. Em produção isso nunca corrompeu
nenhum dado: candidate mode trata qualquer divergência de shadow
(`wasmShadowStatus === "diverged"`) como motivo de fallback automático
para o leitor validado, antes mesmo de tentar materializar a saída.

**Corrigido**: `display_cell_value` agora arredonda o formato "General" a
11 dígitos significativos, a mesma convenção do Excel (seção 35 do
`CURRENT_STATE_AUDIT.md`). Medição após a correção, mesmo corpus de 25
arquivos: **zero divergências** (`divergentWorkbooks: 0`,
`divergentCells: 0`). Validado rodando `cargo test` de verdade via
`.github/workflows/wasm-build.yml` (disparado manualmente), já que este
tipo de sandbox local não linka o crate para testes reais.

**Estado por formato após a correção**: XLSM tem corpus sintético
comparável em volume ao XLSX (25 arquivos, ≥10.000 células) e zero
divergências, mas segue bloqueado para promoção pelo mesmo motivo que
sempre bloqueou — falta o corpus real sanitizado exigido (5 arquivos por
formato, hoje 0/5). XLTX e XLTM seguem sem nenhuma medição. Nenhum dos
três teve a allowlist de candidato (`VITE_WASM_CANDIDATE_FORMATS`)
alterada; XLSX continua sendo o único formato liberado para materializar
saída Rust.

`npm run corpus:sanitize` passou a aceitar `.xltx` como entrada (além de
`.xlsx`), mas a saída sanitizada de um `.xltx` sempre grava um `.xlsx` de
verdade (limite do `XLSX.write` do SheetJS instalado, ver
`docs/WASM_CORPUS_SANITIZATION.md`) — então isso não preenche o gate XLTX,
só amplia as fontes aceitas pro gate XLSX já existente. Usuário trouxe 2
arquivos `.xltx` reais (`FRS-QA-435-Suape Recebimento de Resinas` e `Anexo
FRS-QA-028-Suape`); ao sanitizar, as métricas resultantes (abas, células,
strings/números/datas sanitizados) bateram exatamente com
`sanitized-001.xlsx`/`sanitized-002.xlsx` já presentes no corpus — mesma
regra de duplicata usada na seção 82 do `CURRENT_STATE_AUDIT.md`: são o
mesmo conteúdo de origem (provavelmente exportado como `.xlsx` numa sessão
anterior e como `.xltx` nesta), não contam como fonte nova. XLTX/XLTM
continuam em 0/5, sem nenhum arquivo real disponível que ainda não esteja
no corpus.
