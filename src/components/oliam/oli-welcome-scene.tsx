export function OliWelcomeScene({ busy }: { busy: boolean }) {
  return (
    <div
      className="oli-welcome-scene oli-welcome-wordmark"
      data-busy={busy || undefined}
      role="img"
      aria-label="Oli.Qualidade"
    >
      <span className="oli-wordmark-ball" aria-hidden="true">
        <svg viewBox="0 0 440 420" focusable="false">
          <path
            className="oli-wordmark-outline"
            d="M58 210C53 129 106 60 198 45C286 30 365 75 383 160C403 253 369 330 289 365C210 399 113 374 76 308C59 278 54 244 58 210Z"
          />
          <path className="oli-wordmark-eye" d="M143 137C149 166 163 176 177 143" />
          <path className="oli-wordmark-eye" d="M215 126C219 158 235 168 248 132" />
          <path className="oli-wordmark-smile" d="M121 195C167 234 248 240 300 188" />
        </svg>
      </span>
      <span className="oli-wordmark-name" aria-hidden="true">
        li.Qualidade
      </span>
    </div>
  );
}
