import { FileText } from "lucide-react";
import type { SourceNote } from "@/lib/import-intelligence";

export function SourceNotesPanel(p: { sourceNotes: SourceNote[] | undefined }) {
  if (!p.sourceNotes?.length) return null;
  return (
    <details className="mx-4 mb-4 rounded-2xl border border-primary/20 bg-card shadow-sm md:mx-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-primary" />
          <span className="truncate">Observações da planilha</span>
        </span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
          {p.sourceNotes.length}
        </span>
      </summary>
      <ul className="grid max-h-72 gap-2 overflow-auto border-t border-border p-3 sm:grid-cols-2">
        {p.sourceNotes.map((note, noteIndex) => (
          <li
            key={`${note.address}-${noteIndex}`}
            className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
          >
            <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
              {note.address} · {note.kind === "comment" ? "Comentário" : "Observação"}
              {note.author ? ` · ${note.author}` : ""}
            </span>
            <span className="whitespace-pre-line">{note.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
