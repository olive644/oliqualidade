import { useEffect, useState } from "react";
import { Eye, HardDrive, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBytes, measureStorage, type StoredItem } from "@/lib/storage-usage";
import { listStoredEntries, removeStoredKey } from "@/lib/storage";

/**
 * Central de privacidade: o que fica guardado neste navegador, quanto ocupa,
 * como apagar, e o que exatamente sai daqui quando o assistente é usado.
 *
 * A tela existe porque as duas afirmações que o produto faz — "seus dados
 * ficam com você" e "o assistente não vê dado sensível" — eram promessas sem
 * como conferir. Aqui elas viram número e texto: o tamanho real de cada coisa
 * guardada, e o objeto exato que seria enviado à IA se a pergunta fosse feita
 * agora.
 *
 * O que é mostrado no consentimento não é uma descrição do que o app manda: é
 * o resultado da mesma função que monta o envio (`buildSafeDashboardContext`).
 * Descrição envelhece em silêncio quando o código muda; o objeto real, não.
 */
export function PrivacyCenter({
  open,
  onOpenChange,
  buildAiPayload,
  privateMode,
  onTogglePrivateMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Monta o que seria enviado à IA agora. Só é chamado quando o usuário pede. */
  buildAiPayload: () => unknown;
  privateMode: boolean;
  onTogglePrivateMode: () => void;
}) {
  const [items, setItems] = useState<StoredItem[]>([]);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [payload, setPayload] = useState<string | null>(null);

  const refresh = () => {
    if (typeof window === "undefined") return;
    void listStoredEntries().then((entries) => setItems(measureStorage(entries)));
    void navigator.storage?.estimate?.().then((estimate) => {
      if (typeof estimate.usage === "number" && typeof estimate.quota === "number")
        setQuota({ usage: estimate.usage, quota: estimate.quota });
    });
  };

  useEffect(() => {
    if (open) refresh();
    else setPayload(null);
  }, [open]);

  const clearItem = async (item: StoredItem) => {
    for (const key of item.keys) await removeStoredKey(key);
    refresh();
  };

  const total = items.reduce((sum, item) => sum + item.bytes, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl [&>section]:min-w-0">
        <DialogHeader>
          <DialogTitle>Central de privacidade</DialogTitle>
          <DialogDescription>
            O que fica neste navegador, quanto ocupa e o que sai daqui.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="size-4" /> Guardado neste navegador
          </h3>
          <p className="text-xs text-muted-foreground">
            {items.length
              ? `${formatBytes(total)} em ${items.length} ${items.length === 1 ? "categoria" : "categorias"}.`
              : "Nada guardado por este aplicativo ainda."}
            {quota
              ? ` O navegador reservou ${formatBytes(quota.quota)} para este site e está usando ${formatBytes(quota.usage)}.`
              : ""}
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((item) => (
              <li key={item.kind} className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">{item.description}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {formatBytes(item.bytes)} · {item.keys.length}{" "}
                    {item.keys.length === 1 ? "registro" : "registros"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={item.destructive ? "text-destructive" : undefined}
                  onClick={() => void clearItem(item)}
                  // Apagar painel é perder trabalho; apagar cache não. A
                  // confirmação existe só onde o arrependimento é caro.
                  {...(item.destructive
                    ? { title: "Apaga os painéis salvos e as planilhas importadas" }
                    : {})}
                >
                  <Trash2 className="size-3.5" />
                  Limpar
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="size-4" /> O que sai daqui
          </h3>
          <p className="text-xs text-muted-foreground">
            A leitura da planilha, os cálculos e os gráficos acontecem neste navegador. Duas coisas
            saem, e só quando você pede: a consulta de coordenadas do widget de mapa, e a pergunta
            ao assistente. Colunas identificadas como sensíveis não entram no envio.
          </p>
          {payload === null ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPayload(JSON.stringify(buildAiPayload(), null, 2))}
            >
              Ver exatamente o que seria enviado à IA
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Este é o conteúdo montado agora, pela mesma função que monta o envio de verdade.
              </p>
              {/* w-full mais min-w-0: sem os dois, as linhas longas do JSON
                  esticam o diálogo inteiro e o texto das seções acima sai
                  cortado na borda direita. */}
              <pre className="max-h-64 w-full min-w-0 overflow-auto rounded-xl border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed">
                {payload}
              </pre>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Modo privado</h3>
          <p className="text-xs text-muted-foreground">
            Com o modo privado ligado, painéis e histórico ficam só na memória desta aba e somem ao
            fechá-la.
          </p>
          <Button
            variant={privateMode ? "default" : "outline"}
            size="sm"
            onClick={onTogglePrivateMode}
          >
            {privateMode ? "Modo privado ligado" : "Ligar modo privado"}
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
