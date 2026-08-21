# Compatibilidade de planilhas

A lista aceita pelo seletor de arquivos e a cobertura automatizada usam a mesma matriz versionada em `test-fixtures/workbook-compatibility-matrix.json`.

## Gate de regressão

`npm run compatibility:report` executa uma leitura real de cada formato que pode ser gerado de modo determinístico no CI. Cada arquivo contém cabeçalho, texto e número conhecidos. A execução falha se:

- uma extensão anunciada não estiver na matriz;
- uma extensão aparecer duas vezes;
- a leitura perder o cabeçalho, o texto ou o número;
- algum formato automatizado não produzir um resultado explícito no relatório.

O job `Workbook compatibility matrix` publica dois artefatos por execução:

- `workbook-compatibility-report.md`, para leitura humana;
- `workbook-compatibility-report.json`, para histórico e comparação automática.

## Limite declarado

Apple Numbers permanece com cobertura manual. O projeto aceita `.numbers` por meio do SheetJS, mas o CI não consegue fabricar um pacote Numbers válido; esse formato exige uma fixture real, sanitizada e exportada pelo aplicativo da Apple. O relatório mostra essa lacuna como manual, nunca como aprovação automática.
