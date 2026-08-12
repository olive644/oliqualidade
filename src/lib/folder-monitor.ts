export const FOLDER_MONITOR_INTERVAL_MS = 5_000;

export type FileFingerprint = {
  lastModified: number;
  size: number;
};

export type FolderMonitorStatus = "watching" | "syncing" | "error";

export type FolderMonitorView = {
  folderName: string;
  fileName: string;
  fileCount: number;
  fileNames: string[];
  status: FolderMonitorStatus;
  lastSyncedAt: number;
  error?: string;
};

export type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
};

export type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  resolve: (handle: LocalFileHandle) => Promise<string[] | null>;
  getFileHandle: (name: string) => Promise<LocalFileHandle>;
  entries?: () => AsyncIterableIterator<
    [string, LocalFileHandle | { kind: "directory"; name: string }]
  >;
  values?: () => AsyncIterableIterator<LocalFileHandle | { kind: "directory"; name: string }>;
  queryPermission?: (options?: { mode?: "read" }) => Promise<PermissionState>;
  requestPermission?: (options?: { mode?: "read" }) => Promise<PermissionState>;
};

type LocalPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<LocalDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    startIn?: LocalDirectoryHandle;
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<LocalFileHandle[]>;
};

export type FolderWorkbookSelection = {
  directory: LocalDirectoryHandle;
  handle: LocalFileHandle;
  file: File;
  workbookNames: string[];
};

export async function listSupportedWorkbooks(directory: LocalDirectoryHandle) {
  const names = new Set<string>();
  // Chromium expõe `entries()` de forma mais consistente; algumas versões
  // oferecem apenas `values()`. Aceitar ambos evita a falsa contagem zero.
  if (directory.entries) {
    for await (const [name, entry] of directory.entries())
      if (entry.kind === "file" && isSupportedWorkbook(name)) names.add(name);
  } else if (directory.values) {
    for await (const entry of directory.values())
      if (entry.kind === "file" && isSupportedWorkbook(entry.name)) names.add(entry.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function pickFolderWorkbook(win: Window): Promise<FolderWorkbookSelection> {
  const picker = win as LocalPickerWindow;
  if (!picker.showDirectoryPicker || !picker.showOpenFilePicker) {
    throw new Error("unsupported");
  }
  const directory = await picker.showDirectoryPicker({ mode: "read" });
  // Enumera enquanto a autorização da pasta está recém-concedida. Em algumas
  // versões do Chromium, abrir o seletor de arquivo em seguida pode suspender
  // temporariamente o iterador do diretório e produzir uma falsa lista vazia.
  const listedBeforeFilePicker = await listSupportedWorkbooks(directory);
  const [handle] = await picker.showOpenFilePicker({
    startIn: directory,
    multiple: false,
    types: [
      {
        description: "Planilhas Excel ou CSV",
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
            ".xlsx",
            ".xlsm",
            ".xltx",
            ".xltm",
          ],
          "application/vnd.ms-excel": [".xls"],
          "application/vnd.ms-excel.sheet.binary.macroEnabled.12": [".xlsb"],
          "application/vnd.oasis.opendocument.spreadsheet": [".ods", ".fods"],
          "text/csv": [".csv"],
          "text/tab-separated-values": [".tsv"],
        },
      },
    ],
  });
  if (!handle || !isSupportedWorkbook(handle.name)) throw new Error("unsupported-file");
  const relativePath = await directory.resolve(handle);
  if (!relativePath) throw new Error("outside-directory");
  const listedAfterFilePicker = await listSupportedWorkbooks(directory);
  const workbookNames = [
    ...new Set([...listedBeforeFilePicker, ...listedAfterFilePicker, handle.name]),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { directory, handle, file: await handle.getFile(), workbookNames };
}

export function fingerprint(file: Pick<File, "lastModified" | "size">): FileFingerprint {
  return { lastModified: file.lastModified, size: file.size };
}

export function fileChanged(
  previous: FileFingerprint | undefined,
  file: Pick<File, "lastModified" | "size">,
) {
  if (!previous) return true;
  return previous.lastModified !== file.lastModified || previous.size !== file.size;
}

export function isSupportedWorkbook(name: string) {
  return /\.(xlsx|xlsm|xlsb|xls|xltx|xltm|ods|fods|csv|tsv|xml|html|htm|numbers)$/i.test(name);
}
