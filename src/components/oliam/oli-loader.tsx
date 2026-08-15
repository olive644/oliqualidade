import { cn } from "@/lib/utils";

export function OliLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn("oliam-loader-wrap", compact && "is-compact")}
      role="status"
      aria-label="Carregando"
    >
      <div className="oli-typewriter" aria-hidden="true">
        <span className="oli-typewriter-slide">
          <i />
        </span>
        <span className="oli-typewriter-paper" />
        <span className="oli-typewriter-keyboard" />
      </div>
    </div>
  );
}
