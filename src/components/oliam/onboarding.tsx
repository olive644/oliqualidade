import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const onboardingSteps = [
  {
    title: "Importe seus dados",
    text: "Envie Excel, CSV, ODS ou Numbers, cole uma URL de Google Sheets ou os dados diretamente. Tudo fica salvo neste navegador.",
  },
  {
    title: "Revise antes de confirmar",
    text: "Na etapa de revisão você confere o tipo de cada coluna, renomeia o que for preciso e ajusta antes de gerar o painel.",
  },
  {
    title: "Use a paleta de comandos",
    text: "Dentro de um painel, pressione ⌘K ou Ctrl+K a qualquer momento para buscar ações rapidamente, sem tirar as mãos do teclado.",
  },
];

export function Onboarding({
  step,
  setStep,
  dismiss,
}: {
  step: number;
  setStep: (n: number) => void;
  dismiss: () => void;
}) {
  const current = onboardingSteps[step];
  if (!current) return null;
  const last = step === onboardingSteps.length - 1;
  return (
    <div
      role="dialog"
      aria-label="Boas-vindas ao Oli.Qualidade"
      className="fixed bottom-5 left-5 z-50 w-[min(20rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-panel"
    >
      <div className="flex items-center gap-1.5 px-4 pt-4" aria-hidden="true">
        {onboardingSteps.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= step ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between px-4 pt-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Passo {step + 1} de {onboardingSteps.length}
        </span>
        <button
          aria-label="Fechar boas-vindas"
          onClick={dismiss}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="p-4 pt-2.5">
        <h2 className="font-display text-sm font-semibold">{current.title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{current.text}</p>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-canvas/60 p-3">
        <button
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={dismiss}
        >
          Pular
        </button>
        <Button size="sm" onClick={() => (last ? dismiss() : setStep(step + 1))}>
          {last ? "Concluir" : "Próximo"}
        </Button>
      </div>
    </div>
  );
}
