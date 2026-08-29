import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Dashboard, Row, SheetData } from "@/lib/types";
import { askGemini, AssistantStreamError, type GeminiChatMessage } from "@/lib/gemini-client";
import { ASSISTANT_STOPPED_MESSAGE, type AssistantStreamFailure } from "@/lib/assistant-stream";
import { buildLiveSuggestedPrompts, type LiveDashboardContext } from "@/lib/assistant-context";
import { isCoarsePointer } from "./widget-support";
import { OliFace } from "./oli-face";
import { OliLoader } from "./oli-loader";

/**
 * Como uma fala do assistente terminou.
 *
 * Serve para duas coisas ao mesmo tempo: escolher o acabamento visual da bolha
 * e decidir o que volta como histórico para o modelo. Só o que terminou como
 * `concluida` é resposta de verdade; interrompida, estourada ou falhada
 * continuam na tela para a pessoa ler, mas não viram contexto da próxima
 * pergunta.
 */
type ChatEntryStatus = "concluida" | "interrompida" | AssistantStreamFailure;
type ChatEntry = GeminiChatMessage & { status?: ChatEntryStatus };

const FAILURE_LABELS: Record<AssistantStreamFailure, string> = {
  "inicio-lento": "Tempo esgotado",
  inatividade: "Tempo esgotado",
  "duracao-maxima": "Tempo esgotado",
  "limite-excedido": "Limite excedido",
  provedor: "Falha do assistente",
  rede: "Falha de conexão",
  indisponivel: "Assistente indisponível",
};

function entryLabel(status: ChatEntryStatus | undefined) {
  if (!status || status === "concluida") return null;
  if (status === "interrompida") return ASSISTANT_STOPPED_MESSAGE;
  return FAILURE_LABELS[status];
}

/**
 * Agenda em quadro de vídeo, com plano B.
 *
 * O caminho normal é `requestAnimationFrame`: ele agrupa os deltas na cadência
 * em que a tela realmente desenha, o que é exatamente a frequência útil. O
 * plano B existe para ambiente sem quadro (renderização no servidor, teste sem
 * DOM visual), onde a alternativa seria não atualizar nunca.
 */
const scheduleFrame = (callback: () => void) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : (setTimeout(callback, 16) as unknown as number);

const cancelFrame = (handle: number) => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
};

export function GeminiChatPanel({
  dashboard,
  sheet,
  liveRows,
  liveView,
}: {
  dashboard: Dashboard;
  sheet: SheetData;
  liveRows: Row[];
  liveView: LiveDashboardContext;
}) {
  const [open, setOpen] = useState(false);
  /**
   * O mascote se recolhe enquanto a pessoa está mexendo num gráfico.
   *
   * Ele mora fixo no canto inferior direito, e em 320 px e no modo horizontal
   * isso cai exatamente em cima do rodapé do card: nas imagens de referência ele
   * cobria a linha "Horizontal: Data · Vertical: Soma de Resultado" do gráfico
   * de área. Esconder no celular resolveria a sobreposição e tiraria o
   * assistente de onde a leitura rápida acontece; ancorá-lo na barra inferior
   * gastaria altura permanente, que é o que falta nessas telas.
   *
   * Recolhido, ele encolhe para uma aba discreta na borda e volta assim que a
   * pessoa toca fora de um gráfico. Ou seja, ele sai justamente enquanto
   * atrapalha, e continua alcançável o tempo todo.
   */
  const [recolhido, setRecolhido] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const requestController = useRef<AbortController | null>(null);
  // Buffer do texto que está chegando. Ele vive fora do estado do React de
  // propósito: cada delta escreve aqui, e só o quadro seguinte leva o
  // acumulado para a tela. Sem isso, uma resposta de mil trechos vira mil
  // renderizações.
  const streamBuffer = useRef("");
  const pendingFrame = useRef<number | null>(null);
  const mounted = useRef(true);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const suggestedPrompts = useMemo(() => buildLiveSuggestedPrompts(liveView), [liveView]);
  const focusLabel = liveView.focus?.cell
    ? `${liveView.focus.cell.columnLabel}, linha ${liveView.focus.cell.rowIndex}`
    : liveView.focus?.widget?.title;

  const cancelPendingFrame = useCallback(() => {
    if (pendingFrame.current === null) return;
    cancelFrame(pendingFrame.current);
    pendingFrame.current = null;
  }, []);

  /** Zera buffer, quadro agendado e texto na tela. */
  const resetStream = useCallback(() => {
    cancelPendingFrame();
    streamBuffer.current = "";
    setStreamedAnswer("");
  }, [cancelPendingFrame]);

  const stopResponse = useCallback(() => {
    requestController.current?.abort();
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelPendingFrame();
      requestController.current?.abort();
    };
  }, [cancelPendingFrame]);

  // Trocar de painel ou de aba muda o contexto inteiro da conversa: a resposta
  // em andamento foi pedida sobre outra coisa e não pode aparecer aqui.
  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    setEntries([]);
    setLastQuestion("");
    resetStream();
    setLoading(false);
  }, [dashboard.id, sheet.name, resetStream]);

  // Fechar o painel encerra a resposta. Deixá-la correndo gastaria geração que
  // ninguém está lendo, e reabrir o painel mostraria texto vindo de uma
  // pergunta que a pessoa já abandonou.
  useEffect(() => {
    if (open) return;
    requestController.current?.abort();
  }, [open]);

  // Rolagem automática só enquanto a pessoa está no fim da conversa. Quem
  // subiu para reler algo fica onde estava. O salto é direto, sem animação:
  // rolagem suave a cada quadro de texto novo vira tremor na tela e ignoraria
  // quem pediu menos movimento no sistema.
  useEffect(() => {
    const node = contentRef.current;
    if (!node || !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [entries, streamedAnswer, loading]);

  const handleScroll = () => {
    const node = contentRef.current;
    if (!node) return;
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };

  const appendEntry = (entry: ChatEntry) => setEntries((current) => [...current, entry]);

  const submit = async (question: string) => {
    const message = question.trim();
    if (!message || loading) return;
    setDraft("");
    setLastQuestion(message);
    // O histórico enviado ao modelo é só o que de fato virou diálogo. Erro e
    // resposta interrompida ficam na tela, mas nunca são reapresentados como
    // se o assistente tivesse dito aquilo.
    const history = entries
      .filter((entry) => entry.role === "user" || entry.status === "concluida")
      .map(({ role, text }) => ({ role, text }));
    appendEntry({ role: "user", text: message });
    stickToBottom.current = true;
    resetStream();
    setLoading(true);
    const controller = new AbortController();
    requestController.current = controller;
    const isCurrent = () => mounted.current && requestController.current === controller;

    try {
      const answer = await askGemini(message, dashboard, sheet, liveRows, liveView, history, {
        signal: controller.signal,
        onDelta: (text) => {
          if (!isCurrent()) return;
          streamBuffer.current += text;
          if (pendingFrame.current !== null) return;
          pendingFrame.current = scheduleFrame(() => {
            pendingFrame.current = null;
            if (!isCurrent()) return;
            setStreamedAnswer(streamBuffer.current);
          });
        },
      });
      if (!isCurrent()) return;
      appendEntry({ role: "assistant", text: answer, status: "concluida" });
    } catch (error) {
      if (!isCurrent()) return;
      // Parada pedida pela pessoa. O texto que já chegou continua visível,
      // marcado como interrompido, e não volta como histórico.
      if (controller.signal.aborted) {
        const partial = streamBuffer.current.trim();
        appendEntry({
          role: "assistant",
          text: partial || ASSISTANT_STOPPED_MESSAGE,
          status: "interrompida",
        });
        return;
      }
      appendEntry({
        role: "assistant",
        text: error instanceof Error ? error.message : "Não foi possível responder.",
        status: error instanceof AssistantStreamError ? error.reason : "indisponivel",
      });
    } finally {
      if (mounted.current && requestController.current === controller) {
        requestController.current = null;
        resetStream();
        setLoading(false);
      }
    }
  };

  const canRetry = !loading && Boolean(lastQuestion) && entries.at(-1)?.status !== "concluida";

  useEffect(() => {
    // Só no toque. No desktop o ponteiro não fica em cima do que está sendo
    // lido, e recolher ali seria movimento sem motivo.
    if (!isCoarsePointer()) return;
    // Com a conversa aberta o mascote já não é o que está por cima.
    if (open) return;
    const dentroDeGrafico = (alvo: EventTarget | null) =>
      alvo instanceof Element && alvo.closest(".recharts-wrapper, .oliam-widget-detail") !== null;
    const aoTocar = (evento: PointerEvent) => setRecolhido(dentroDeGrafico(evento.target));
    document.addEventListener("pointerdown", aoTocar, { passive: true });
    return () => document.removeEventListener("pointerdown", aoTocar);
  }, [open]);

  return (
    <div className="oli-assistant-shell" data-recolhido={recolhido ? "true" : undefined}>
      {open && (
        <section className="oli-chat-panel" aria-label="Conversa com o assistente Oli">
          <header className="oli-chat-header">
            <div className="oli-chat-identity">
              <span className="oli-chat-avatar">
                <OliFace compact />
              </span>
              <div>
                <strong>Oli</strong>
                <p>
                  {sheet.name} · {liveView.visibleRows} linhas
                  {focusLabel ? ` · Foco: ${focusLabel}` : ""}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="Fechar assistente"
              className="oli-chat-close"
            >
              <X className="size-4" />
            </Button>
          </header>
          <div
            className="oli-chat-content"
            ref={contentRef}
            onScroll={handleScroll}
            aria-live="polite"
            aria-busy={loading}
          >
            {!entries.length && (
              <div className="oli-chat-welcome">
                <strong>O que você quer entender neste painel?</strong>
                <span>
                  {focusLabel
                    ? `Estou considerando o foco atual em ${focusLabel}. Use uma sugestão ou escreva sua pergunta.`
                    : "Passe o mouse ou selecione um widget para dar foco, ou escreva sua pergunta."}
                </span>
              </div>
            )}
            {entries.map((entry, index) => {
              const label = entryLabel(entry.status);
              return (
                <div
                  key={`${entry.role}-${index}`}
                  className={cn("oli-chat-message", `oli-chat-message-${entry.role}`)}
                  data-status={entry.status}
                >
                  {entry.text}
                  {label && <span className="oli-chat-message-note">{label}</span>}
                </div>
              );
            })}
            {streamedAnswer && (
              // Sem anúncio incremental: um leitor de tela repetiria a resposta
              // inteira a cada trecho novo. A fala concluída entra na lista
              // acima, que é a região viva, e é anunciada uma vez.
              <div
                className="oli-chat-message oli-chat-message-assistant"
                data-status="gerando"
                aria-live="off"
              >
                {streamedAnswer}
              </div>
            )}
            {loading && !streamedAnswer && (
              <div className="oli-chat-loading">
                <OliLoader compact />
                <span>Analisando o painel…</span>
              </div>
            )}
          </div>
          {loading && (
            <div className="oli-chat-live">
              <span role="status">
                {streamedAnswer ? "Escrevendo a resposta" : "Analisando o painel"}
              </span>
              <button type="button" className="oli-chat-stop" onClick={stopResponse}>
                <Square className="size-3.5" aria-hidden="true" />
                Parar resposta
              </button>
            </div>
          )}
          {canRetry && (
            <div className="oli-chat-live">
              <span>Quer tentar de novo?</span>
              <button
                type="button"
                className="oli-chat-stop"
                onClick={() => void submit(lastQuestion)}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Tentar novamente
              </button>
            </div>
          )}
          <div className="oli-chat-suggestions" aria-label="Perguntas sugeridas para esta visão">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={loading}
                onClick={() => void submit(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <form
            className="oli-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(draft);
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
              placeholder="Pergunte sobre este painel…"
              aria-label="Mensagem para o assistente"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!draft.trim() || loading}
              aria-label="Enviar mensagem"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </section>
      )}
      <div className="oli-mascot-group" data-open={open || undefined}>
        <span className="oli-chat-invite" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 9h8" />
            <path d="M8 13h6" />
            <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12z" />
          </svg>
          <strong>{open ? "Fechar conversa" : "Converse comigo!"}</strong>
        </span>
        <button
          type="button"
          className="oli-mascot"
          data-state={loading ? "thinking" : open ? "chatting" : "idle"}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Fechar conversa com Oli" : "Conversar com Oli"}
        >
          <OliFace />
          <span className="oli-mascot-name">Oli</span>
        </button>
      </div>
    </div>
  );
}
