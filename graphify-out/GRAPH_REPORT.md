# Oli.Qualidade — Architecture Graph

Generated from the current TypeScript source tree using the local structural fallback.

## Summary

- Files: 150
- Nodes: 473
- Relationships: 605
- Communities: 6

## Communities

- Application Components
- Application Routes
- Auto Dashboard Engine
- Import Intelligence
- Shared Libraries
- UI System

## God Nodes

- `file:src/lib/types.ts` — degree 59
- `file:src/lib/utils.ts` — degree 46
- `file:src/routes/index.tsx` — degree 41
- `file:src/lib/import-intelligence.ts` — degree 30
- `file:src/lib/spreadsheet-intelligence.ts` — degree 27
- `file:src/lib/import-workbench.ts` — degree 26
- `file:src/lib/data-pipeline.ts` — degree 24
- `file:src/lib/widgets.ts` — degree 24
- `file:src/lib/import.ts` — degree 22
- `file:src/lib/auto-dashboard.ts` — degree 21

## Current architecture landmarks

- Import Intelligence detects spreadsheet structure, quality signals, sensitive data, formulas, merges, filters and independent regions.
- Auto Dashboard Engine converts the analyzed dataset into explainable metric and widget recommendations.
- Application Routes orchestrate import review, reporting, dashboard rendering and on-demand exports.

## Provenance

All nodes and relationships are marked `EXTRACTED`. Imports are resolved from TypeScript source; exported symbols are read from the TypeScript AST. The installed graphify executable could not start under the current process sandbox, so no inferred semantic edges were added.
