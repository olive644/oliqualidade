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
