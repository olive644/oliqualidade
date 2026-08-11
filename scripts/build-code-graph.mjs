import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const outputRoot = path.join(root, "graphify-out");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function community(file) {
  const normalized = relative(file);
  if (normalized.includes("auto-dashboard")) return "Auto Dashboard Engine";
  if (normalized.includes("import-intelligence")) return "Import Intelligence";
  if (normalized.startsWith("src/routes/")) return "Application Routes";
  if (normalized.startsWith("src/components/ui/")) return "UI System";
  if (normalized.startsWith("src/components/")) return "Application Components";
  if (normalized.startsWith("src/server/")) return "Server Services";
  return "Shared Libraries";
}

function resolveImport(from, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const files = walk(sourceRoot).sort();
const nodes = [];
const links = [];
const seenLinks = new Set();

function addLink(source, target, relationship) {
  const key = `${source}|${target}|${relationship}`;
  if (seenLinks.has(key)) return;
  seenLinks.add(key);
  links.push({ source, target, relationship, provenance: "EXTRACTED" });
}

for (const file of files) {
  const id = `file:${relative(file)}`;
  nodes.push({
    id,
    label: relative(file),
    kind: "file",
    file_type: path.extname(file).slice(1),
    source_file: relative(file),
    source_location: relative(file),
    community: community(file),
    community_name: community(file),
    provenance: "EXTRACTED",
  });

  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  source.forEachChild((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveImport(file, statement.moduleSpecifier.text);
      if (target) addLink(id, `file:${relative(target)}`, "imports");
    }

    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) return;
    const declarationName = statement.name?.getText(source);
    if (!declarationName) return;
    const symbolId = `symbol:${relative(file)}#${declarationName}`;
    nodes.push({
      id: symbolId,
      label: declarationName,
      kind: ts.SyntaxKind[statement.kind],
      file_type: path.extname(file).slice(1),
      source_file: relative(file),
      source_location: `${relative(file)}:${source.getLineAndCharacterOfPosition(statement.pos).line + 1}`,
      community: community(file),
      community_name: community(file),
      provenance: "EXTRACTED",
    });
    addLink(id, symbolId, "exports");
  });
}

const degree = new Map(nodes.map((node) => [node.id, 0]));
for (const link of links) {
  degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
  degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
}
const hubs = [...degree.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([id, count]) => ({ id, degree: count }));
const communities = [...new Set(nodes.map((node) => node.community))].sort();

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(
  path.join(outputRoot, "graph.json"),
  `${JSON.stringify(
    {
      directed: true,
      multigraph: false,
      graph: {
        generator: "local TypeScript structural fallback",
        community_labels: Object.fromEntries(communities.map((name) => [name, name])),
      },
      nodes,
      links,
    },
    null,
    2,
  )}\n`,
);

const report = `# Oli.Qualidade — Architecture Graph\n\nGenerated from the current TypeScript source tree using the local structural fallback.\n\n## Summary\n\n- Files: ${files.length}\n- Nodes: ${nodes.length}\n- Relationships: ${links.length}\n- Communities: ${communities.length}\n\n## Communities\n\n${communities.map((name) => `- ${name}`).join("\n")}\n\n## God Nodes\n\n${hubs.map((hub) => `- \`${hub.id}\` — degree ${hub.degree}`).join("\n")}\n\n## Current architecture landmarks\n\n- Import Intelligence detects spreadsheet structure, quality signals, sensitive data, formulas, merges, filters and independent regions.\n- Auto Dashboard Engine converts the analyzed dataset into explainable metric and widget recommendations.\n- Application Routes orchestrate import review, reporting, dashboard rendering and on-demand exports.\n\n## Provenance\n\nAll nodes and relationships are marked \`EXTRACTED\`. Imports are resolved from TypeScript source; exported symbols are read from the TypeScript AST. The installed graphify executable could not start under the current process sandbox, so no inferred semantic edges were added.\n`;
fs.writeFileSync(path.join(outputRoot, "GRAPH_REPORT.md"), report);

const html = `<!doctype html><meta charset="utf-8"><title>Oli.Qualidade Architecture Graph</title><style>body{font:14px system-ui;margin:32px;color:#172033}h1{color:#087f5b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{border:1px solid #dfe5e2;border-radius:12px;padding:16px}code{font-size:12px}</style><h1>Oli.Qualidade Architecture Graph</h1><p>${nodes.length} nodes · ${links.length} relationships · ${communities.length} communities</p><div class="grid">${communities.map((name) => `<section class="card"><h2>${name}</h2><p>${nodes.filter((node) => node.community === name).length} nodes</p></section>`).join("")}</div><h2>Most connected</h2><ol>${hubs.map((hub) => `<li><code>${hub.id}</code> — ${hub.degree}</li>`).join("")}</ol>`;
fs.writeFileSync(path.join(outputRoot, "graph.html"), html);

console.log(`Graph written: ${nodes.length} nodes, ${links.length} relationships.`);
