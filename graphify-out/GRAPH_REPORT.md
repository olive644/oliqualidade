# Graph Report - oliqualidade  (2026-08-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1775 nodes · 3729 edges · 165 communities (98 shown, 67 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d0158266`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lib.rs
- import-intelligence.ts
- import.ts
- cn
- import-workbench.ts
- sidebar.tsx
- data-pipeline.ts
- index.tsx
- spreadsheet-intelligence.ts
- dashboard.ts
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
- Dashboard
- auto-dashboard.ts
- workbook-reading-engine.ts
- oli_ooxml_core.js
- OliAm
- scripts
- gemini-security.ts
- formula.ts
- gemini-server.ts
- wasm-shadow-corpus.test.ts
- workbook-sanitizer.mjs
- components.json
- format.ts
- devDependencies
- command.tsx
- menubar.tsx
- smart-import.ts
- properties
- enum
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
- assistant-context.ts
- required
- properties
- table.tsx
- required
- breadcrumb.tsx
- navigation-menu.tsx
- diagnostic
- generate-problematic-fixture.mjs
- error-capture.ts
- http-security.ts
- package.json
- check-performance-budget.mjs
- types.ts
- $defs
- build-ooxml-wasm.mjs
- alert.tsx
- maxCompressionRatio
- start
- generate-workbook-corpus.mjs
- preview-vercel.mjs
- oli_ooxml_core.d.ts
- limits
- maxEntries
- maxEntryUncompressedBytes
- maxSharedStrings
- maxStructuralRecords
- maxTextBytes
- suspiciousRatioMinBytes
- main
- canvg
- folder-monitor-widget.tsx
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
- export-layout.ts
- typescript-eslint
- vite
- vitest
- security-smoke.mjs
- workbook-sanitizer.d.mts
- oli-ooxml-core
- cmdk
- @eslint/js

## God Nodes (most connected - your core abstractions)
1. `cn()` - 245 edges
2. `Dashboard()` - 47 edges
3. `WidgetCard()` - 33 edges
4. `Row` - 32 edges
5. `Column` - 27 edges
6. `sheetToRows()` - 27 edges
7. `readWorkbookBytesWithEngine()` - 27 edges
8. `OliAm()` - 25 edges
9. `compilerOptions` - 22 edges
10. `createWidget()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `OliAm()` --indirect_call--> `saveDashboards()`  [INFERRED]
  src/routes/index.tsx → src/lib/storage.ts
- `SummaryStrip()` --calls--> `cn()`  [EXTRACTED]
  src/components/operational-widget-body.tsx → src/lib/utils.ts
- `Pagination()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/pagination.tsx → src/lib/utils.ts
- `PaginationEllipsis()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/pagination.tsx → src/lib/utils.ts
- `PaginationNext()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/pagination.tsx → src/lib/utils.ts

## Import Cycles
- 2-file cycle: `rust/oli-ooxml-core/src/excel_date.rs -> rust/oli-ooxml-core/src/lib.rs -> rust/oli-ooxml-core/src/excel_date.rs`

## Communities (165 total, 67 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.07
Nodes (84): BytesRef, BytesStart, Decoder, Default, Error, From, HashMap, JsValue (+76 more)

### Community 1 - "import-intelligence.ts"
Cohesion: 0.06
Nodes (56): AdvancedColumnQuality, AdvancedQualityReport, analyzeAdvancedQuality(), numeric(), quantile(), analyzeFormulas(), containsSensitiveValues(), detectDateLocaleCandidates() (+48 more)

### Community 2 - "import.ts"
Cohesion: 0.06
Nodes (59): attendanceRosterRows(), Block, blocksToRows(), buildSourceGrid(), calendarParts(), cellHasValue(), cellLooksDate(), cellLooksNumeric() (+51 more)

### Community 3 - "cn"
Cohesion: 0.06
Nodes (53): AccordionContent, AccordionItem, AccordionTrigger, Avatar, AvatarFallback, AvatarImage, Card, CardContent (+45 more)

### Community 4 - "import-workbench.ts"
Cohesion: 0.11
Nodes (35): SourceGrid, adaptImportProfile(), applyImportSelection(), buildSheetHealth(), canonicalProfileTokens(), ColumnPair, compareVersions(), defaultSelection() (+27 more)

### Community 5 - "sidebar.tsx"
Cohesion: 0.06
Nodes (40): Input, Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+32 more)

### Community 6 - "data-pipeline.ts"
Cohesion: 0.15
Nodes (23): aggregate(), applyMissingRules(), barChartPresentation(), chartSeries(), detectQualitySignals(), groupAndAggregate(), JoinResult, leftJoin() (+15 more)

### Community 7 - "index.tsx"
Cohesion: 0.07
Nodes (26): createLatestTaskQueue(), LatestTaskQueue, sizeClass(), spanClass(), AxisTick(), CalculationButton(), calculationCopy, ChartDotProps (+18 more)

### Community 8 - "spreadsheet-intelligence.ts"
Cohesion: 0.07
Nodes (45): decodeCellAddress(), encodeCellAddress(), VersionDiff, buildReviewAnalysis(), analyzeReviewInBackground(), REVIEW_ANALYSIS_TIMEOUT_MS, WorkerResponse, ReviewAnalysisInput (+37 more)

### Community 9 - "dashboard.ts"
Cohesion: 0.22
Nodes (15): AUTOMATIC_OPERATIONAL_TYPES, LegacyDashboard, mergeReimportedColumns(), mergeReimportedSheets(), migrateDashboard(), migrateDashboards(), refreshAutomaticWidgets(), repairInvalidWidgets() (+7 more)

### Community 10 - "review-export.ts"
Cohesion: 0.13
Nodes (29): cryptoBytes(), decoder, decryptDashboardBackup(), encoder, encryptDashboardBackup(), EncryptedEnvelope, fromBase64(), keyFromPassword() (+21 more)

### Community 11 - "compilerOptions"
Cohesion: 0.06
Nodes (31): DOM, DOM.Iterable, ES2022, eslint.config.js, src/**/*.ts, src/**/*.tsx, vite/client, vite.config.ts (+23 more)

### Community 12 - "utils.ts"
Cohesion: 0.08
Nodes (19): Badge(), BadgeProps, badgeVariants, Checkbox, HoverCardContent, InputOTP, InputOTPGroup, InputOTPSeparator (+11 more)

### Community 13 - "widgets.ts"
Cohesion: 0.18
Nodes (23): fixture, numericKinds, buildDefaultWidgets(), columnDragType(), columnDropAccepted(), createWidget(), defaultSize(), defaultSpan() (+15 more)

### Community 14 - "ooxml-reader.ts"
Cohesion: 0.15
Nodes (24): measureWorkbookFidelity(), WorkbookFidelityReport, Archive, archiveText(), attributes(), BUILTIN_FORMATS, comparable(), compareAndRepairWithOoxml() (+16 more)

### Community 15 - "storage.ts"
Cohesion: 0.10
Nodes (30): FileFingerprint, geocodeMissing(), geocodePlace(), throttle(), DASH_KEY, estimateBytes(), GEOCODE_KEY, GeocodeCache (+22 more)

### Community 16 - "operational-widgets.ts"
Cohesion: 0.13
Nodes (25): AttendanceBody(), chartTooltipStyle, ControlChartBody(), OperationalWidgetBody(), OperationalWidgetType, PlanVsActualBody(), SummaryStrip(), ValidationBody() (+17 more)

### Community 17 - "routeTree.gen.ts"
Cohesion: 0.10
Nodes (19): Toaster(), ToasterProps, getRouter(), Route, Route, Route, FileRoutesByFullPath, FileRoutesById (+11 more)

### Community 18 - "workbook-reader.ts"
Cohesion: 0.12
Nodes (25): candidates, fixtures, copyValidatedWorkbookMetadata(), decodeText(), detectDelimiter(), MAX_SUSPICIOUS_COMPRESSION_RATIO, MAX_WORKBOOK_CELLS, MAX_WORKBOOK_SHEETS (+17 more)

### Community 19 - "alert-dialog.tsx"
Cohesion: 0.12
Nodes (21): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+13 more)

### Community 20 - "Dashboard"
Cohesion: 0.16
Nodes (22): applyCellEdit(), AuditEntry, CorrectionSuggestion, markSourceRows(), parseEditedValue(), recordUndo(), SOURCE_ROW_INDEX, sourceRowIndexOf() (+14 more)

### Community 21 - "auto-dashboard.ts"
Cohesion: 0.14
Nodes (19): AutoDashboardInput, buildRecommendedWidgets(), clampScore(), classifyDashboardColumn(), DashboardColumnClassification, DashboardColumnRole, DashboardRecommendation, DashboardRecommendationKind (+11 more)

### Community 22 - "workbook-reading-engine.ts"
Cohesion: 0.13
Nodes (23): OoxmlInspection, canUseWasmCandidate(), compareWasmInventory(), configuredWasmCandidateFormats(), configuredWasmReaderMode(), configuredWasmSampleRate(), normalizeWasmCandidateFormats(), normalizeWasmReaderMode() (+15 more)

### Community 23 - "oli_ooxml_core.js"
Cohesion: 0.16
Nodes (20): fixture, inventory, root, wasm, inventoryWorkbookWithWasm(), isInventory(), registerWasmWorkbookReader(), WasmWorkbookInventory (+12 more)

### Community 24 - "OliAm"
Cohesion: 0.26
Nodes (13): fileChanged(), fingerprint(), FOLDER_MONITOR_INTERVAL_MS, FolderMonitorStatus, FolderWorkbookSelection, isSupportedWorkbook(), listSupportedWorkbooks(), LocalDirectoryHandle (+5 more)

### Community 25 - "scripts"
Cohesion: 0.10
Nodes (21): scripts, build, build:dev, corpus:sanitize, dev, format, graph:build, lint (+13 more)

### Community 26 - "gemini-security.ts"
Cohesion: 0.16
Nodes (20): LiveWidgetSnapshot, ALLOWED_OPERATIONS, asNumber(), buckets, buildCrossAnalyses(), buildSafeDashboardContext(), CrossAnalysis, finiteNumber() (+12 more)

### Community 27 - "formula.ts"
Cohesion: 0.20
Nodes (8): conditionalAggregate(), ConditionalValue, FUNCTIONS, matchesCriterion(), Parser, resolveFormulaCell(), splitFormulaArguments(), wildcardPattern()

### Community 28 - "gemini-server.ts"
Cohesion: 0.20
Nodes (19): checkRateLimit(), detectPromptInjection(), GeminiDashboardInput, resetRateLimitsForTests(), dashboard, smartImport, validateChatHistory(), validateChatMessage() (+11 more)

### Community 29 - "wasm-shadow-corpus.test.ts"
Cohesion: 0.14
Nodes (16): GeneratedCase, GeneratedManifest, generatedManifestPath, sanitizedManifestPath, wasm, assessWasmPromotion(), assessWasmPromotionByFormat(), DEFAULT_WASM_PROMOTION_CRITERIA (+8 more)

### Community 30 - "workbook-sanitizer.mjs"
Cohesion: 0.19
Nodes (13): inputArgument, outputArgument, digest(), escapeRegExp(), privateSourceId(), pseudonym(), removeWorkbookMetadata(), sanitizeCell() (+5 more)

### Community 31 - "components.json"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 32 - "format.ts"
Cohesion: 0.21
Nodes (15): conditionalColor(), evalFormula(), formulaColumnRefs(), infer(), inferColumns(), inferOne(), numericKindFromName(), palette (+7 more)

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
Cohesion: 0.21
Nodes (14): ALLOWED_KINDS, buildSmartImportInput(), cleanText(), analyzeImportWithAi(), CacheEntry, readCache(), writeCache(), parseSmartImportAnalysis() (+6 more)

### Community 37 - "properties"
Cohesion: 0.12
Nodes (16): type, properties, pattern, type, type, type, type, address (+8 more)

### Community 38 - "enum"
Cohesion: 0.17
Nodes (16): enum, type, type, declaredDimension, path, rawValue, sheetId, type (+8 more)

### Community 39 - "build-code-graph.mjs"
Cohesion: 0.13
Nodes (12): communities, community(), degree, files, hubs, links, nodes, outputRoot (+4 more)

### Community 40 - "dependencies"
Cohesion: 0.13
Nodes (15): class-variance-authority, fflate, dependencies, class-variance-authority, fflate, @radix-ui/react-navigation-menu, @radix-ui/react-radio-group, @radix-ui/react-tabs (+7 more)

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

### Community 58 - "assistant-context.ts"
Cohesion: 0.14
Nodes (23): buildLiveDashboardContext(), BuildLiveDashboardContextInput, buildLiveSuggestedPrompts(), emptyWidget(), groupedWidget(), LiveDashboardContext, LiveSeriesItem, metricWidget() (+15 more)

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
Cohesion: 0.25
Nodes (8): additionalProperties, required, type, archive, compressedBytes, entries, limits, maxCompressionRatio

### Community 63 - "breadcrumb.tsx"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 64 - "navigation-menu.tsx"
Cohesion: 0.29
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 65 - "diagnostic"
Cohesion: 0.29
Nodes (7): diagnostic, additionalProperties, required, type, code, message, severity

### Community 66 - "generate-problematic-fixture.mjs"
Cohesion: 0.29
Nodes (6): archive, rows, sheet, sideBySide, workbook, workbookBytes

### Community 67 - "error-capture.ts"
Cohesion: 0.38
Nodes (4): describeError(), describeStatus(), originalConsoleError, safeStringify()

### Community 68 - "http-security.ts"
Cohesion: 0.43
Nodes (5): isSameOriginBrowserRequest(), MAX_CHAT_BODY_BYTES, readLimitedJson(), SECURITY_HEADERS, withSecurityHeaders()

### Community 69 - "package.json"
Cohesion: 0.33
Nodes (5): license, name, private, sideEffects, type

### Community 70 - "check-performance-budget.mjs"
Cohesion: 0.33
Nodes (5): assets, assetsDir, budgets, failures, largest

### Community 71 - "types.ts"
Cohesion: 0.14
Nodes (15): columns, trendWidget, AutoDashboardPlan, BookmarkSort, bookmarkView(), createBookmark(), columns, ChartDataMode (+7 more)

### Community 72 - "$defs"
Cohesion: 0.40
Nodes (5): $defs, sheet, sheet, additionalProperties, type

### Community 73 - "build-ooxml-wasm.mjs"
Cohesion: 0.40
Nodes (4): crate, output, result, root

### Community 74 - "alert.tsx"
Cohesion: 0.50
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

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

### Community 81 - "maxEntries"
Cohesion: 0.67
Nodes (3): minimum, type, maxEntries

### Community 82 - "maxEntryUncompressedBytes"
Cohesion: 0.67
Nodes (3): minimum, type, maxEntryUncompressedBytes

### Community 83 - "maxSharedStrings"
Cohesion: 0.67
Nodes (3): minimum, type, maxSharedStrings

### Community 84 - "maxStructuralRecords"
Cohesion: 0.67
Nodes (3): minimum, type, maxStructuralRecords

### Community 85 - "maxTextBytes"
Cohesion: 0.67
Nodes (3): minimum, type, maxTextBytes

### Community 86 - "suspiciousRatioMinBytes"
Cohesion: 0.67
Nodes (3): suspiciousRatioMinBytes, minimum, type

### Community 89 - "folder-monitor-widget.tsx"
Cohesion: 0.36
Nodes (6): extensionOf(), FolderMonitorWidget(), FolderMonitorWidgetProps, FORMAT_LABELS, formatSyncTime(), FolderMonitorView

### Community 146 - "export-layout.ts"
Cohesion: 0.36
Nodes (6): captureScale(), EXPORT_SURFACE_WIDTH, MAX_EXPORT_PIXELS, pdfPageSlices(), PdfTablePage, pdfTablePages()

## Knowledge Gaps
- **521 isolated node(s):** `AdvancedColumnQuality`, `DetectedFieldKind`, `FormulaDiagnostic`, `NormalizationResult`, `SourceCellRepresentation` (+516 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **67 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `import-workbench.ts`, `sidebar.tsx`, `data-pipeline.ts`, `index.tsx`, `utils.ts`, `widgets.ts`, `operational-widgets.ts`, `alert-dialog.tsx`, `Dashboard`, `OliAm`, `command.tsx`, `menubar.tsx`, `form.tsx`, `carousel.tsx`, `chart.tsx`, `assistant-context.ts`, `table.tsx`, `breadcrumb.tsx`, `navigation-menu.tsx`, `alert.tsx`, `folder-monitor-widget.tsx`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `Row` connect `types.ts` to `format.ts`, `import-intelligence.ts`, `import.ts`, `gemini-security.ts`, `import-workbench.ts`, `data-pipeline.ts`, `index.tsx`, `spreadsheet-intelligence.ts`, `dashboard.ts`, `review-export.ts`, `widgets.ts`, `operational-widgets.ts`, `Dashboard`, `auto-dashboard.ts`, `assistant-context.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `diagnostic`, `ooxml-inventory.schema.json`, `hiddenColumnRange`, `required`, `required`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `AdvancedColumnQuality`, `DetectedFieldKind`, `FormulaDiagnostic` to the rest of the system?**
  _521 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.06965871902758299 - nodes in this community are weakly interconnected._
- **Should `import-intelligence.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05750658472344162 - nodes in this community are weakly interconnected._
- **Should `import.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06233538191395961 - nodes in this community are weakly interconnected._