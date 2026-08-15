import { cn } from "@/lib/utils";

export function OliFace({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn("oli-face", compact && "oli-face-compact")} aria-hidden="true">
      <svg viewBox="0 0 440 420" focusable="false">
        <path
          className="oli-face-outline"
          d="M58 210C53 129 106 60 198 45C286 30 365 75 383 160C403 253 369 330 289 365C210 399 113 374 76 308C59 278 54 244 58 210Z"
        />
        <path className="oli-face-eye" d="M143 137C149 166 163 176 177 143" />
        <path className="oli-face-eye" d="M215 126C219 158 235 168 248 132" />
        <path className="oli-face-smile" d="M121 195C167 234 248 240 300 188" />
      </svg>
    </span>
  );
}
