import { useRef, useState } from "react";
import { GitMerge, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inferColumns } from "@/lib/format";
import { leftJoin } from "@/lib/data-pipeline";
import { preferredSheetIndex, type SheetOption } from "@/lib/import";
import { readWorkbookFile } from "@/lib/workbook-reader-client";
import { WORKBOOK_ACCEPT, WORKBOOK_FORMATS_LABEL } from "@/lib/workbook-reader";
import type { Column, Row } from "@/lib/types";
import { SheetPickerDialog } from "./sheet-picker-dialog";

/**
 * Encapsula todo o fluxo de "combinar planilha" (left join com uma segunda
 * planilha importada na hora): estado, leitura do arquivo, escolha de aba
 * quando há mais de uma, e o diálogo em si. O chamador só precisa de
 * `openJoin()` para abrir (de qualquer gatilho) e renderizar `dialog` uma
 * vez na árvore — nenhum dos ~9 estados internos do fluxo antigo precisa
 * viver no componente que usa este hook.
 */
export function useJoinSheetDialog(
  columns: Column[],
  rows: Row[],
  onCombine: (patch: { rows: Row[]; columns: Column[] }) => void,
) {
  const [open, setOpen] = useState(false);
  const [joinRows, setJoinRows] = useState<Row[] | null>(null);
  const [joinFileName, setJoinFileName] = useState("");
  const [joinDragging, setJoinDragging] = useState(false);
  const [joinBaseKey, setJoinBaseKey] = useState("");
  const [joinOtherKey, setJoinOtherKey] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [sheetPicker, setSheetPicker] = useState<{
    fileName: string;
    sheets: SheetOption[];
  } | null>(null);
  const [sheetPickerIndex, setSheetPickerIndex] = useState(0);
  const joinInput = useRef<HTMLInputElement>(null);

  const resetJoin = () => {
    setJoinRows(null);
    setJoinFileName("");
    setJoinBaseKey("");
    setJoinOtherKey("");
    setJoinError(null);
    if (joinInput.current) joinInput.current.value = "";
  };

  const openJoin = () => {
    resetJoin();
    setOpen(true);
  };

  const applyJoinSheet = (rowsToJoin: Row[], fileName: string) => {
    setJoinRows(rowsToJoin);
    setJoinFileName(fileName);
    setJoinOtherKey(Object.keys(rowsToJoin[0] ?? {})[0] ?? "");
    setJoinBaseKey(columns[0]?.key ?? "");
    setJoinError(null);
  };

  const parseJoinFile = async (file: File) => {
    try {
      const sheets = await readWorkbookFile(file);
      if (!sheets.length) {
        setJoinError("Essa planilha está vazia ou não foi possível lê-la.");
        return;
      }
      if (sheets.length === 1) {
        applyJoinSheet(sheets[0]!.rows, file.name);
        return;
      }
      // Mais de uma aba com dado: deixa o usuário escolher, em vez de
      // combinar direto com a primeira e descartar o resto silenciosamente.
      setSheetPicker({ fileName: file.name, sheets });
      setSheetPickerIndex(preferredSheetIndex(sheets));
    } catch {
      setJoinError(
        `Não foi possível ler esse arquivo. Formatos aceitos: ${WORKBOOK_FORMATS_LABEL}.`,
      );
    }
  };

  const confirmSheetPicker = () => {
    if (!sheetPicker) return;
    const chosen = sheetPicker.sheets[sheetPickerIndex];
    if (!chosen) return;
    applyJoinSheet(chosen.rows, sheetPicker.fileName);
    setSheetPicker(null);
  };

  const combineJoin = () => {
    if (!joinRows || !joinBaseKey || !joinOtherKey) return;
    const existingKeys = columns.map((c) => c.key);
    const { rows: joinedRows, addedKeys } = leftJoin(
      rows,
      joinBaseKey,
      joinRows,
      joinOtherKey,
      existingKeys,
    );
    if (!addedKeys.length) {
      setJoinError("A segunda planilha não tem colunas novas para combinar.");
      return;
    }
    const newColumns = inferColumns(joinedRows, addedKeys);
    onCombine({ rows: joinedRows, columns: [...columns, ...newColumns] });
    setOpen(false);
    resetJoin();
  };

  const dialog = (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetJoin();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Combinar planilha</DialogTitle>
            <DialogDescription>
              Importe uma segunda planilha e combine com o painel atual por uma coluna em comum
              (left join: todas as linhas do painel são mantidas, e os campos da segunda planilha
              entram como colunas novas).
            </DialogDescription>
          </DialogHeader>
          {!joinRows ? (
            <button
              className="oliam-dropzone w-full"
              data-dragging={joinDragging}
              onClick={() => joinInput.current?.click()}
              type="button"
              onDragEnter={(e) => {
                e.preventDefault();
                setJoinDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                e.preventDefault();
                setJoinDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setJoinDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void parseJoinFile(file);
              }}
            >
              <Upload className="size-6 text-primary" />
              <strong>{joinDragging ? "Solte o arquivo aqui" : "Enviar segunda planilha"}</strong>
              <span className="text-sm text-muted-foreground">Excel, CSV, ODS ou Numbers</span>
            </button>
          ) : (
            <div className="space-y-3">
              <p className="font-mono text-xs text-muted-foreground">
                {joinFileName} · {joinRows.length} linhas
              </p>
              <label className="block text-sm">
                Coluna de correspondência no painel atual
                <select
                  className="oliam-select mt-1 w-full max-w-none"
                  value={joinBaseKey}
                  onChange={(e) => setJoinBaseKey(e.target.value)}
                >
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Coluna de correspondência na nova planilha
                <select
                  className="oliam-select mt-1 w-full max-w-none"
                  value={joinOtherKey}
                  onChange={(e) => setJoinOtherKey(e.target.value)}
                >
                  {Object.keys(joinRows[0] ?? {}).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Linhas do painel sem correspondência na nova planilha ficam com essas novas colunas
                em branco.
              </p>
            </div>
          )}
          {joinError && <p className="text-xs text-destructive">{joinError}</p>}
          <input
            ref={joinInput}
            type="file"
            accept={WORKBOOK_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void parseJoinFile(file);
            }}
          />
          {joinRows && (
            <DialogFooter>
              <Button variant="ghost" onClick={resetJoin}>
                Trocar arquivo
              </Button>
              <Button onClick={combineJoin}>
                <GitMerge />
                Combinar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {sheetPicker && (
        <SheetPickerDialog
          fileName={sheetPicker.fileName}
          sheets={sheetPicker.sheets}
          selected={sheetPickerIndex}
          onSelectedChange={setSheetPickerIndex}
          onConfirm={confirmSheetPicker}
          onCancel={() => setSheetPicker(null)}
        />
      )}
    </>
  );

  return { openJoin, dialog };
}
