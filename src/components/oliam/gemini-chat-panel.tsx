import { useEffect, useMemo, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Dashboard, Row, SheetData } from "@/lib/types";
import { askGemini, type GeminiChatMessage } from "@/lib/gemini-client";
import { buildLiveSuggestedPrompts, type LiveDashboardContext } from "@/lib/assistant-context";
import { OliFace } from "./oli-face";
import { OliLoader } from "./oli-loader";

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
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<GeminiChatMessage[]>([]);
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const suggestedPrompts = useMemo(() => buildLiveSuggestedPrompts(liveView), [liveView]);
  const focusLabel = liveView.focus?.cell
    ? `${liveView.focus.cell.columnLabel}, linha ${liveView.focus.cell.rowIndex}`
    : liveView.focus?.widget?.title;

  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    setMessages([]);
    setStreamedAnswer("");
    setLoading(false);
    return () => requestController.current?.abort();
  }, [dashboard.id, sheet.name]);

  const submit = async (suggestedMessage?: string) => {
    const message = (suggestedMessage ?? draft).trim();
    if (!message || loading) return;
    setDraft("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setStreamedAnswer("");
    setLoading(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const answer = await askGemini(message, dashboard, sheet, liveRows, liveView, messages, {
        signal: controller.signal,
        onUpdate: (partialAnswer) => {
          if (requestController.current === controller) setStreamedAnswer(partialAnswer);
        },
      });
      if (requestController.current !== controller) return;
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch (error) {
      if (controller.signal.aborted || requestController.current !== controller) return;
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: error instanceof Error ? error.message : "Não foi possível responder.",
        },
      ]);
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setStreamedAnswer("");
        setLoading(false);
      }
    }
  };

  return (
    <div className="oli-assistant-shell">
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
          <div className="oli-chat-content" aria-live="polite" aria-busy={loading}>
            {!messages.length && (
              <div className="oli-chat-welcome">
                <strong>O que você quer entender neste painel?</strong>
                <span>
                  {focusLabel
                    ? `Estou considerando o foco atual em ${focusLabel}. Use uma sugestão ou escreva sua pergunta.`
                    : "Passe o mouse ou selecione um widget para dar foco, ou escreva sua pergunta."}
                </span>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn("oli-chat-message", `oli-chat-message-${message.role}`)}
              >
                {message.text}
              </div>
            ))}
            {streamedAnswer && (
              <div className="oli-chat-message oli-chat-message-assistant">{streamedAnswer}</div>
            )}
            {loading && !streamedAnswer && (
              <div className="oli-chat-loading" role="status">
                <OliLoader compact />
                <span>Analisando o painel…</span>
              </div>
            )}
          </div>
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
              void submit();
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
