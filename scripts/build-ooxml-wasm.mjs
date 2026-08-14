import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "rust", "oli-ooxml-core");
const output = join(root, "src", "wasm", "oli-ooxml-core");
const command = process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack";
const result = spawnSync(
  command,
  [
    "build",
    crate,
    "--target",
    "web",
    "--release",
    "--out-dir",
    output,
    "--out-name",
    "oli_ooxml_core",
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// O pacote é versionado como artefato web; esses dois arquivos gerados são
// redundantes e a regra `*` impediria o Git de enxergar o binário atualizado.
rmSync(join(output, ".gitignore"), { force: true });
rmSync(join(output, "README.md"), { force: true });
