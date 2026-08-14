# Oli.Qualidade

Leitor de planilhas e construtor de painéis explicáveis, com importação local,
revisão de qualidade, widgets operacionais e exportações.

O ponto de entrada para entender, operar e evoluir o projeto é o
[Second Brain](docs/SECOND_BRAIN.md).

## Verificação completa

```bash
npm run verify
```

O núcleo Rust isolado possui uma verificação própria:

```bash
npm run rust:test
```

Para regenerar o mapa estrutural extraído do código:

```bash
npm run graph:build
```
