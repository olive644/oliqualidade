# Oli.Qualidade — Architecture Graph

Generated from the current TypeScript source tree using the local structural fallback.

## Summary

- Files: 88
- Nodes: 219
- Relationships: 269
- Communities: 5

## Communities

- Application Routes
- Auto Dashboard Engine
- Import Intelligence
- Shared Libraries
- UI System

## God Nodes

- `file:src/lib/utils.ts` — degree 45
- `file:src/lib/types.ts` — degree 35
- `file:src/routes/index.tsx` — degree 23
- `file:src/lib/import-intelligence.ts` — degree 20
- `file:src/lib/auto-dashboard.ts` — degree 17
- `file:src/lib/data-pipeline.ts` — degree 17
- `file:src/lib/format.ts` — degree 15
- `file:src/lib/widgets.ts` — degree 15
- `file:src/lib/folder-monitor.ts` — degree 12
- `file:src/lib/storage.ts` — degree 12

## Current architecture landmarks

- Import Intelligence detects spreadsheet structure, quality signals, sensitive data, formulas, merges, filters and independent regions.
- Auto Dashboard Engine converts the analyzed dataset into explainable metric and widget recommendations.
- Application Routes orchestrate import review, reporting, dashboard rendering and on-demand exports.

## Provenance

All nodes and relationships are marked `EXTRACTED`. Imports are resolved from TypeScript source; exported symbols are read from the TypeScript AST. The installed graphify executable could not start under the current process sandbox, so no inferred semantic edges were added.
