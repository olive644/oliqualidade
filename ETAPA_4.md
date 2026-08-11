# Etapa 4 — normalização e metadados do Excel

Sem commit/push.

## Implementado

- Normalização interna de números/moedas no padrão brasileiro.
- Percentuais convertidos para representação numérica interna.
- CPF/CNPJ/CEP/telefone normalizados apenas para validação.
- Booleanos em português/inglês.
- Preservação do valor original continua sendo responsabilidade da camada de importação.
- Detecção e exposição do intervalo de AutoFilter.
- Nome das tabelas estruturadas do Excel quando disponível.
- Exemplos de fórmulas detectadas e preservadas no diagnóstico.
- Testes unitários para a normalização.

## Validação

`npx tsc --noEmit -p tsconfig.json` não pôde concluir neste ambiente porque a instalação presente não contém `vite/client`. Nenhum build foi declarado como aprovado.
