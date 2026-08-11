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
  values?: () => AsyncIterableIterator<LocalFileHandle | { kind: "directory"; name: string }>;
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
  if (!directory.values) return [];
  const names: string[] = [];
  for await (const entry of directory.values())
    if (entry.kind === "file" && isSupportedWorkbook(entry.name)) names.push(entry.name);
  return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function pickFolderWorkbook(win: Window): Promise<FolderWorkbookSelection> {
  const picker = win as LocalPickerWindow;
  if (!picker.showDirectoryPicker || !picker.showOpenFilePicker) {
    throw new Error("unsupported");
  }
  const directory = await picker.showDirectoryPicker({ mode: "read" });
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
          "text/csv": [".csv"],
        },
      },
    ],
  });
  if (!handle || !isSupportedWorkbook(handle.name)) throw new Error("unsupported-file");
  const relativePath = await directory.resolve(handle);
  if (!relativePath) throw new Error("outside-directory");
  const listed = await listSupportedWorkbooks(directory);
  const workbookNames = listed.length ? listed : [handle.name];
  return { directory, handle, file: await handle.getFile(), workbookNames };
}

export function fingerprint(file: Pick<File, "lastModified" | "size">): FileFingerprint {
  return { lastModified: file.lastModified, size: file.size };
}

export function fileChanged(previous: FileFingerprint, file: Pick<File, "lastModified" | "size">) {
  return previous.lastModified !== file.lastModified || previous.size !== file.size;
}

export function isSupportedWorkbook(name: string) {
  return /\.(csv|xlsx|xls|xlsm|xltx|xltm)$/i.test(name);
}
