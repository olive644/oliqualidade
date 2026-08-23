const socialLinks = [
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@oliqualidade.app?_r=1&_t=ZS-997t3NVTTLY",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" d="M14 3v10.5a4.5 4.5 0 1 1-4-4.24" />
        <path fill="none" d="M14 3c.8 2.3 2.4 3.7 5 4" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/galeria.oli?igsi=MWMxZ3Eybjl5eHl4NQ==",
    icon: (
      <svg viewBox="0 0 448 512" aria-hidden="true">
        <path d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z" />
      </svg>
    ),
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/oliqualidade/",
    icon: (
      <svg viewBox="0 0 448 512" aria-hidden="true">
        <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
      </svg>
    ),
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-canvas px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
        <figure
          className="group flex cursor-default flex-col items-center outline-none"
          tabIndex={0}
          aria-label="José Oliver, fundador da aplicação"
        >
          <img
            src="/founder-jose-oliver.png"
            alt="Ilustração de José Oliver"
            className="h-28 w-28 object-contain opacity-10 transition duration-500 group-hover:-translate-y-1 group-hover:opacity-100 group-focus:opacity-100 motion-reduce:transform-none motion-reduce:transition-none sm:h-32 sm:w-32"
          />
          <figcaption className="mt-2 text-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus:opacity-100">
            <strong className="block font-display text-sm font-semibold">joséoliver</strong>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Fundador da aplicação
            </span>
          </figcaption>
        </figure>

        <nav className="mt-5 flex items-center gap-3" aria-label="Redes sociais do OliQualidade">
          {socialLinks.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              aria-label={`OliQualidade no ${social.label}`}
              title={social.label}
              className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transform-none"
            >
              <span className="[&>svg]:size-5 [&>svg]:fill-current [&>svg]:stroke-current [&>svg]:stroke-[1.8] [&>svg]:stroke-linecap-round [&>svg]:stroke-linejoin-round">
                {social.icon}
              </span>
            </a>
          ))}
        </nav>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          2026 OliQualidade. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
}
