# Graph Report - oliqualidade  (2026-08-14)

## Corpus Check
- 192 files · ~150,344 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1839 nodes · 3797 edges · 166 communities (97 shown, 69 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9b7a774a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lib.rs
- import-intelligence.ts
- import.ts
- cn
- import-workbench.ts
- sidebar.tsx
- assistant-context.ts
- index.tsx
- spreadsheet-intelligence.ts
- Auditoria do estado atual — 2026-08-13
- review-export.ts
- compilerOptions
- utils.ts
- widgets.ts
- ooxml-reader.ts
- storage.ts
- operational-widgets.ts
- routeTree.gen.ts
- workbook-reader.ts
- alert-dialog.tsx
- worksheetCellAtAddress
- auto-dashboard.ts
- workbook-reading-engine.ts
- oli_ooxml_core.js
- folder-monitor.ts
- scripts
- gemini-security.ts
- schedule-normalizer.ts
- gemini-server.ts
- wasm-shadow-corpus.test.ts
- workbook-sanitizer.mjs
- components.json
- select.tsx
- devDependencies
- command.tsx
- menubar.tsx
- smart-import.ts
- properties
- string
- build-code-graph.mjs
- dependencies
- form.tsx
- carousel.tsx
- workbook-reader-client.ts
- ooxml-inventory.schema.json
- $ref
- properties
- oli-ooxml-core/package.json
- server.ts
- chat-session.ts
- properties
- required
- properties
- hiddenColumnRange
- required
- chart.tsx
- properties
- items
- Critérios de promoção do núcleo Rust/WASM
- required
- properties
- table.tsx
- required
- breadcrumb.tsx
- input-otp.tsx
- diagnostic
- generate-problematic-fixture.mjs
- error-capture.ts
- Sanitiza&ccedil;&atilde;o local do corpus WASM
- package.json
- check-performance-budget.mjs
- types.ts
- $defs
- build-ooxml-wasm.mjs
- badge.tsx
- maxCompressionRatio
- start
- generate-workbook-corpus.mjs
- preview-vercel.mjs
- oli_ooxml_core.d.ts
- limits
- maxSheets
- maxEntryUncompressedBytes
- maxSharedStrings
- maxXmlEvents
- maxTextBytes
- suspiciousRatioMinBytes
- main
- styleIndex
- Routes
- clsx
- date-fns
- embla-carousel-react
- eslint-config-prettier
- eslint-plugin-react-refresh
- exceljs
- globals
- @hookform/resolvers
- input-otp
- lucide-react
- nitro
- html2canvas-pro
- jspdf
- leaflet
- @radix-ui/react-accordion
- @radix-ui/react-alert-dialog
- @radix-ui/react-aspect-ratio
- @radix-ui/react-avatar
- @radix-ui/react-checkbox
- @radix-ui/react-collapsible
- @radix-ui/react-context-menu
- @radix-ui/react-dialog
- @radix-ui/react-dropdown-menu
- @radix-ui/react-hover-card
- @radix-ui/react-label
- @radix-ui/react-menubar
- @radix-ui/react-popover
- @radix-ui/react-progress
- @radix-ui/react-scroll-area
- @radix-ui/react-select
- @radix-ui/react-separator
- @radix-ui/react-slider
- @radix-ui/react-slot
- @radix-ui/react-switch
- @radix-ui/react-toggle
- @radix-ui/react-toggle-group
- @radix-ui/react-tooltip
- react-day-picker
- react-dom
- react-hook-form
- react-resizable-panels
- recharts
- sonner
- tailwind-merge
- tailwindcss
- @tailwindcss/vite
- @tanstack/react-query
- @tanstack/react-router
- @tanstack/react-start
- @tanstack/react-virtual
- @tanstack/router-plugin
- vaul
- xlsx
- zod
- @types/node
- @types/react-dom
- class-variance-authority
- typescript-eslint
- vite
- vitest
- security-smoke.mjs
- workbook-sanitizer.d.mts
- oli-ooxml-core
- cmdk
- @eslint/js
- oli-ooxml-core/README.md

## God Nodes (most connected - your core abstractions)
1. `cn()` - 245 edges
2. `Dashboard()` - 47 edges
3. `WidgetCard()` - 33 edges
4. `Row` - 32 edges
5. `sheetToRows()` - 27 edges
6. `Column` - 27 edges
7. `readWorkbookBytesWithEngine()` - 26 edges
8. `OliAm()` - 25 edges
9. `Auditoria do estado atual — 2026-08-13` - 23 edges
10. `compilerOptions` - 22 edges

## Surprising Connections (you probably didn't know these)
- `finish_cell()` --calls--> `is_date_format()`  [INFERRED]
  rust/oli-ooxml-core/src/lib.rs → rust/oli-ooxml-core/src/excel_date.rs
- `matches_the_public_problematic_fixture()` --calls--> `inventory_ooxml()`  [INFERRED]
  rust/oli-ooxml-core/tests/inventory.rs → rust/oli-ooxml-core/src/lib.rs
- `SummaryStrip()` --calls--> `cn()`  [EXTRACTED]
  src/components/operational-widget-body.tsx → src/lib/utils.ts
- `AlertDialogOverlay` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/alert-dialog.tsx → src/lib/utils.ts
- `AlertTitle` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/alert.tsx → src/lib/utils.ts

## Import Cycles
- 2-file cycle: `rust/oli-ooxml-core/src/excel_date.rs -> rust/oli-ooxml-core/src/lib.rs -> rust/oli-ooxml-core/src/excel_date.rs`

## Communities (166 total, 69 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.07
Nodes (84): BytesRef, BytesStart, Decoder, Default, Error, From, HashMap, JsValue (+76 more)

### Community 1 - "import-intelligence.ts"
Cohesion: 0.06
Nodes (59): AdvancedColumnQuality, AdvancedQualityReport, analyzeAdvancedQuality(), numeric(), quantile(), analyzeFormulas(), containsSensitiveValues(), detectDateLocaleCandidates() (+51 more)

### Community 2 - "import.ts"
Cohesion: 0.05
Nodes (58): conditionalAggregate(), ConditionalValue, FUNCTIONS, matchesCriterion(), Parser, resolveFormulaCell(), splitFormulaArguments(), wildcardPattern() (+50 more)

### Community 3 - "cn"
Cohesion: 0.05
Nodes (58): AccordionContent, AccordionItem, AccordionTrigger, Avatar, AvatarFallback, AvatarImage, Card, CardContent (+50 more)

### Community 4 - "import-workbench.ts"
Cohesion: 0.08
Nodes (45): SourceGrid, adaptImportProfile(), applyImportSelection(), buildSheetHealth(), canonicalProfileTokens(), ColumnPair, compareVersions(), defaultSelection() (+37 more)

### Community 5 - "sidebar.tsx"
Cohesion: 0.06
Nodes (40): Input, Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+32 more)

### Community 6 - "assistant-context.ts"
Cohesion: 0.09
Nodes (42): buildLiveDashboardContext(), BuildLiveDashboardContextInput, buildLiveSuggestedPrompts(), emptyWidget(), groupedWidget(), LiveSeriesItem, metricWidget(), percent() (+34 more)

### Community 7 - "index.tsx"
Cohesion: 0.06
Nodes (49): applyCellEdit(), auditEntry, CorrectionSuggestion, markSourceRows(), parseEditedValue(), recordUndo(), SOURCE_ROW_INDEX, sourceRowIndexOf() (+41 more)

### Community 8 - "spreadsheet-intelligence.ts"
Cohesion: 0.09
Nodes (31): decodeCellAddress(), encodeCellAddress(), buildCanonicalCells(), buildPivotMatrix(), canonicalAddress(), CanonicalCell, ClassifiedRegion, classifyRegions() (+23 more)

### Community 9 - "Auditoria do estado atual — 2026-08-13"
Cohesion: 0.05
Nodes (41): 10. Primeira implementação mensurável, 11. Núcleo Rust de inventário OOXML — fase 1, 12. Núcleo Rust de células OOXML — fase 2, 13. Núcleo Rust de fidelidade estrutural OOXML — fase 3, 14. Adaptador WASM em shadow mode — fase 4, 15. Medição de corpus e gate de promoção — fase 5, 16. Corpus reproduzível e paridade estrutural — fase 6, 17. Sanitização local do corpus real — fase 7 (+33 more)

### Community 10 - "review-export.ts"
Cohesion: 0.10
Nodes (36): LiveDashboardContext, cryptoBytes(), decoder, decryptDashboardBackup(), encoder, encryptDashboardBackup(), EncryptedEnvelope, fromBase64() (+28 more)

### Community 11 - "compilerOptions"
Cohesion: 0.06
Nodes (31): DOM, DOM.Iterable, ES2022, eslint.config.js, src/**/*.ts, src/**/*.tsx, vite/client, vite.config.ts (+23 more)

### Community 12 - "utils.ts"
Cohesion: 0.08
Nodes (18): Alert, AlertDescription, AlertTitle, alertVariants, Checkbox, HoverCardContent, PopoverContent, Progress (+10 more)

### Community 13 - "widgets.ts"
Cohesion: 0.18
Nodes (23): fixture, numericKinds, buildDefaultWidgets(), columnDragType(), columnDropAccepted(), createWidget(), defaultSize(), defaultSpan() (+15 more)

### Community 14 - "ooxml-reader.ts"
Cohesion: 0.19
Nodes (16): Archive, archiveText(), attributes(), BUILTIN_FORMATS, inspectOoxml(), OoxmlSheetStructure, ReaderCell, readSheet() (+8 more)

### Community 15 - "storage.ts"
Cohesion: 0.10
Nodes (31): geocodeMissing(), geocodePlace(), throttle(), DASH_KEY, estimateBytes(), GEOCODE_KEY, GeocodeCache, GeoPoint (+23 more)

### Community 16 - "operational-widgets.ts"
Cohesion: 0.13
Nodes (25): AttendanceBody(), chartTooltipStyle, ControlChartBody(), OperationalWidgetBody(), OperationalWidgetType, PlanVsActualBody(), SummaryStrip(), ValidationBody() (+17 more)

### Community 17 - "routeTree.gen.ts"
Cohesion: 0.10
Nodes (19): Toaster(), ToasterProps, getRouter(), Route, Route, Route, FileRoutesByFullPath, FileRoutesById (+11 more)

### Community 18 - "workbook-reader.ts"
Cohesion: 0.14
Nodes (22): decodeText(), detectDelimiter(), MAX_SUSPICIOUS_COMPRESSION_RATIO, MAX_WORKBOOK_CELLS, MAX_WORKBOOK_SHEETS, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_UNCOMPRESSED_BYTES (+14 more)

### Community 19 - "alert-dialog.tsx"
Cohesion: 0.12
Nodes (21): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+13 more)

### Community 20 - "worksheetCellAtAddress"
Cohesion: 0.22
Nodes (12): measureWorkbookFidelity(), WorkbookFidelityReport, comparable(), compareAndRepairWithOoxml(), ReaderDivergence, attachWorkbookFeatures(), cellAddresses(), normalized() (+4 more)

### Community 21 - "auto-dashboard.ts"
Cohesion: 0.09
Nodes (36): AutoDashboardInput, AutoDashboardPlan, buildRecommendedWidgets(), clampScore(), classifyDashboardColumn(), DashboardColumnClassification, DashboardColumnRole, DashboardRecommendation (+28 more)

### Community 22 - "workbook-reading-engine.ts"
Cohesion: 0.13
Nodes (24): OoxmlInspection, canUseWasmCandidate(), compareWasmInventory(), configuredWasmCandidateFormats(), configuredWasmReaderMode(), configuredWasmSampleRate(), normalizeWasmCandidateFormats(), normalizeWasmReaderMode() (+16 more)

### Community 23 - "oli_ooxml_core.js"
Cohesion: 0.17
Nodes (19): fixture, inventory, root, wasm, inventoryWorkbookWithWasm(), isInventory(), WasmWorkbookInventory, cachedTextDecoder (+11 more)

### Community 24 - "folder-monitor.ts"
Cohesion: 0.15
Nodes (18): extensionOf(), FolderMonitorWidget(), FolderMonitorWidgetProps, FORMAT_LABELS, formatSyncTime(), fileChanged(), FileFingerprint, fingerprint() (+10 more)

### Community 25 - "scripts"
Cohesion: 0.10
Nodes (21): scripts, build, build:dev, corpus:sanitize, dev, format, graph:build, lint (+13 more)

### Community 26 - "gemini-security.ts"
Cohesion: 0.12
Nodes (27): LiveWidgetSnapshot, ALLOWED_OPERATIONS, asNumber(), buckets, buildCrossAnalyses(), buildSafeDashboardContext(), CrossAnalysis, detectPromptInjection() (+19 more)

### Community 27 - "schedule-normalizer.ts"
Cohesion: 0.35
Nodes (9): evaluateScheduleValue(), parseScheduleCriterion(), parseScheduleNumber(), scheduleCellState, ScheduleCriterion, scheduleCriterionForRow(), ScheduleEvaluation, ScheduleMetrics (+1 more)

### Community 28 - "gemini-server.ts"
Cohesion: 0.21
Nodes (17): checkRateLimit(), validateDashboardInput(), GeminiApiError, GeminiEnvironment, geminiFailure(), GeminiInteraction, handleGeminiChat(), handleSmartImportAnalysis() (+9 more)

### Community 29 - "wasm-shadow-corpus.test.ts"
Cohesion: 0.14
Nodes (16): GeneratedCase, GeneratedManifest, generatedManifestPath, sanitizedManifestPath, wasm, assessWasmPromotion(), assessWasmPromotionByFormat(), DEFAULT_WASM_PROMOTION_CRITERIA (+8 more)

### Community 30 - "workbook-sanitizer.mjs"
Cohesion: 0.19
Nodes (13): inputArgument, outputArgument, digest(), escapeRegExp(), privateSourceId(), pseudonym(), removeWorkbookMetadata(), sanitizeCell() (+5 more)

### Community 31 - "components.json"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 32 - "select.tsx"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 33 - "devDependencies"
Cohesion: 0.12
Nodes (17): eslint, eslint-plugin-prettier, eslint-plugin-react-hooks, devDependencies, eslint, eslint-plugin-prettier, eslint-plugin-react-hooks, prettier (+9 more)

### Community 34 - "command.tsx"
Cohesion: 0.12
Nodes (15): Command, CommandDialog(), CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator (+7 more)

### Community 35 - "menubar.tsx"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 36 - "smart-import.ts"
Cohesion: 0.20
Nodes (15): ALLOWED_KINDS, buildSmartImportInput(), cleanText(), analyzeImportWithAi(), CacheEntry, markSmartImportAutoAnalysis(), readCache(), writeCache() (+7 more)

### Community 37 - "properties"
Cohesion: 0.10
Nodes (21): type, properties, enum, pattern, type, type, type, type (+13 more)

### Community 38 - "string"
Cohesion: 0.32
Nodes (8): type, type, declaredDimension, path, sheetId, type, null, string

### Community 39 - "build-code-graph.mjs"
Cohesion: 0.13
Nodes (12): communities, community(), degree, files, hubs, links, nodes, outputRoot (+4 more)

### Community 40 - "dependencies"
Cohesion: 0.13
Nodes (15): canvg, fflate, dependencies, canvg, fflate, @radix-ui/react-navigation-menu, @radix-ui/react-radio-group, @radix-ui/react-tabs (+7 more)

### Community 41 - "form.tsx"
Cohesion: 0.19
Nodes (12): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+4 more)

### Community 42 - "carousel.tsx"
Cohesion: 0.19
Nodes (13): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+5 more)

### Community 43 - "workbook-reader-client.ts"
Cohesion: 0.25
Nodes (8): SheetOption, MAX_WORKBOOK_BYTES, readWorkbookFile(), readWorkbookFileWithReport(), StalledWorker, WORKBOOK_READ_TIMEOUT_MS, WorkerResponse, WorkbookReadResult

### Community 44 - "ooxml-inventory.schema.json"
Cohesion: 0.15
Nodes (12): additionalProperties, $id, required, $schema, title, type, archive, dateSystem (+4 more)

### Community 45 - "$ref"
Cohesion: 0.15
Nodes (13): items, type, items, type, items, type, $ref, cells (+5 more)

### Community 46 - "properties"
Cohesion: 0.15
Nodes (13): properties, minimum, type, minimum, type, minimum, type, minimum (+5 more)

### Community 47 - "oli-ooxml-core/package.json"
Cohesion: 0.15
Nodes (12): oli_ooxml_core_bg.wasm, oli_ooxml_core.d.ts, oli_ooxml_core.js, ./snippets/*, files, license, main, name (+4 more)

### Community 48 - "server.ts"
Cohesion: 0.27
Nodes (9): consumeLastCapturedError(), renderErrorPage(), fetch(), getServerEntry(), isH3SwallowedErrorBody(), normalizeCatastrophicSsrResponse(), ServerEntry, csrfMiddleware (+1 more)

### Community 49 - "chat-session.ts"
Cohesion: 0.33
Nodes (10): base64url(), chatSessionCookieName, cookieValue(), createChatSession(), decodeBase64url(), encoder, hmac(), userAgentFingerprint() (+2 more)

### Community 50 - "properties"
Cohesion: 0.17
Nodes (12): oneOf, type, actualDimension, name, relationshipId, state, type, properties (+4 more)

### Community 51 - "required"
Cohesion: 0.17
Nodes (12): required, actualDimension, cells, declaredDimension, hiddenColumns, hiddenRows, mergedRanges, name (+4 more)

### Community 52 - "properties"
Cohesion: 0.18
Nodes (11): $ref, enum, const, properties, archive, dateSystem, format, schemaVersion (+3 more)

### Community 53 - "hiddenColumnRange"
Cohesion: 0.18
Nodes (11): hiddenColumnRange, maximum, minimum, type, additionalProperties, properties, required, type (+3 more)

### Community 54 - "required"
Cohesion: 0.18
Nodes (11): required, maxCells, maxEntries, maxEntryUncompressedBytes, maxSharedStrings, maxSheets, maxStructuralRecords, maxTextBytes (+3 more)

### Community 55 - "chart.tsx"
Cohesion: 0.25
Nodes (9): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, getPayloadConfigFromPayload(), THEMES (+1 more)

### Community 56 - "properties"
Cohesion: 0.20
Nodes (10): properties, minimum, type, minimum, type, compressedBytes, entries, uncompressedBytes (+2 more)

### Community 57 - "items"
Cohesion: 0.20
Nodes (10): items, type, maximum, minimum, pattern, type, items, type (+2 more)

### Community 58 - "Critérios de promoção do núcleo Rust/WASM"
Cohesion: 0.33
Nodes (5): Amostragem, Ativação e rollback, Corpus e decisão, Critérios de promoção do núcleo Rust/WASM, Gate padrão

### Community 59 - "required"
Cohesion: 0.22
Nodes (9): additionalProperties, required, type, cell, address, cellType, displayValue, rawValue (+1 more)

### Community 60 - "properties"
Cohesion: 0.22
Nodes (9): type, properties, type, code, message, severity, enum, info (+1 more)

### Community 61 - "table.tsx"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 62 - "required"
Cohesion: 0.22
Nodes (9): additionalProperties, required, type, archive, compressedBytes, entries, limits, maxCompressionRatio (+1 more)

### Community 63 - "breadcrumb.tsx"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 64 - "input-otp.tsx"
Cohesion: 0.40
Nodes (4): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 65 - "diagnostic"
Cohesion: 0.29
Nodes (7): diagnostic, additionalProperties, required, type, code, message, severity

### Community 66 - "generate-problematic-fixture.mjs"
Cohesion: 0.29
Nodes (6): archive, rows, sheet, sideBySide, workbook, workbookBytes

### Community 67 - "error-capture.ts"
Cohesion: 0.38
Nodes (4): describeError(), describeStatus(), originalConsoleError, safeStringify()

### Community 68 - "Sanitiza&ccedil;&atilde;o local do corpus WASM"
Cohesion: 0.50
Nodes (3): Execu&ccedil;&atilde;o, Garantias e limites, Sanitiza&ccedil;&atilde;o local do corpus WASM

### Community 69 - "package.json"
Cohesion: 0.33
Nodes (5): license, name, private, sideEffects, type

### Community 70 - "check-performance-budget.mjs"
Cohesion: 0.33
Nodes (5): assets, assetsDir, budgets, failures, largest

### Community 71 - "types.ts"
Cohesion: 0.11
Nodes (26): BookmarkSort, bookmarkView(), createBookmark(), columns, evalFormula(), formulaColumnRefs(), infer(), inferColumns() (+18 more)

### Community 72 - "$defs"
Cohesion: 0.40
Nodes (5): $defs, sheet, sheet, additionalProperties, type

### Community 73 - "build-ooxml-wasm.mjs"
Cohesion: 0.40
Nodes (4): crate, output, result, root

### Community 74 - "badge.tsx"
Cohesion: 0.67
Nodes (3): Badge(), BadgeProps, badgeVariants

### Community 75 - "maxCompressionRatio"
Cohesion: 0.50
Nodes (4): exclusiveMinimum, minimum, type, maxCompressionRatio

### Community 76 - "start"
Cohesion: 0.50
Nodes (4): start, maximum, minimum, type

### Community 78 - "preview-vercel.mjs"
Cohesion: 0.50
Nodes (3): mimeTypes, port, staticRoot

### Community 79 - "oli_ooxml_core.d.ts"
Cohesion: 0.50
Nodes (3): InitInput, InitOutput, SyncInitInput

### Community 80 - "limits"
Cohesion: 0.67
Nodes (3): additionalProperties, type, limits

### Community 81 - "maxSheets"
Cohesion: 0.67
Nodes (3): minimum, type, maxSheets

### Community 82 - "maxEntryUncompressedBytes"
Cohesion: 0.67
Nodes (3): minimum, type, maxEntryUncompressedBytes

### Community 83 - "maxSharedStrings"
Cohesion: 0.67
Nodes (3): minimum, type, maxSharedStrings

### Community 84 - "maxXmlEvents"
Cohesion: 0.67
Nodes (3): minimum, type, maxXmlEvents

### Community 85 - "maxTextBytes"
Cohesion: 0.67
Nodes (3): minimum, type, maxTextBytes

### Community 86 - "suspiciousRatioMinBytes"
Cohesion: 0.67
Nodes (3): suspiciousRatioMinBytes, minimum, type

### Community 88 - "styleIndex"
Cohesion: 0.67
Nodes (3): styleIndex, minimum, type

## Knowledge Gaps
- **568 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `css` (+563 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **69 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `import-workbench.ts`, `sidebar.tsx`, `assistant-context.ts`, `index.tsx`, `utils.ts`, `widgets.ts`, `storage.ts`, `operational-widgets.ts`, `alert-dialog.tsx`, `folder-monitor.ts`, `select.tsx`, `command.tsx`, `menubar.tsx`, `form.tsx`, `carousel.tsx`, `chart.tsx`, `table.tsx`, `breadcrumb.tsx`, `input-otp.tsx`, `badge.tsx`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `diagnostic`, `ooxml-inventory.schema.json`, `hiddenColumnRange`, `required`, `required`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `Row` connect `types.ts` to `import-intelligence.ts`, `import.ts`, `import-workbench.ts`, `assistant-context.ts`, `index.tsx`, `spreadsheet-intelligence.ts`, `review-export.ts`, `widgets.ts`, `operational-widgets.ts`, `auto-dashboard.ts`, `gemini-security.ts`, `schedule-normalizer.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _568 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.06965871902758299 - nodes in this community are weakly interconnected._
- **Should `import-intelligence.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05593561368209256 - nodes in this community are weakly interconnected._
- **Should `import.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.053946053946053944 - nodes in this community are weakly interconnected._