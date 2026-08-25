/**
 * Widget do Turnstile no navegador, sob demanda.
 *
 * Nada é carregado enquanto o servidor não pedir. Esse é o ponto: o script da
 * Cloudflare só entra na página quando uma resposta 403 disser que falta a
 * verificação, o que na prática acontece uma vez a cada duas horas de uso, e
 * nunca para quem já tem a prova. Carregar sempre custaria uma requisição a
 * um terceiro em toda visita, inclusive nas que nem abrem o assistente.
 *
 * O modo é `interaction-only`: a Cloudflare decide sozinha, e só desenha algo
 * na tela quando desconfia. No caso comum a pessoa não vê nada além de a
 * resposta demorar uma fração de segundo a mais.
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CONTAINER_ID = "oli-turnstile";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: string;
      callback: (token: string) => void;
      "error-callback": (code?: string) => void;
      "timeout-callback"?: () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileSiteKey(): string | null {
  const key = import.meta.env["VITE_TURNSTILE_SITE_KEY"];
  return typeof key === "string" && key ? key : null;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile carregou sem expor a API."));
    });
    script.addEventListener("error", () =>
      reject(new Error("Não foi possível carregar o Turnstile.")),
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    // Uma falha de carregamento não pode congelar as tentativas seguintes:
    // sem limpar a promessa, o primeiro erro (rede caindo, bloqueador de
    // conteúdo momentâneo) valeria para o resto da sessão.
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

function container(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;
  const element = document.createElement("div");
  element.id = CONTAINER_ID;
  // O widget precisa estar no documento para a Cloudflare medi-lo e desenhar
  // o desafio; `display:none` faria a verificação falhar em vez de ficar
  // invisível. No modo interaction-only ele não ocupa espaço enquanto não há
  // desafio.
  element.style.position = "fixed";
  element.style.bottom = "1rem";
  element.style.right = "1rem";
  element.style.zIndex = "60";
  document.body.append(element);
  return element;
}

let widgetId: string | null = null;
let pending: ((result: { token: string } | { error: string }) => void) | null = null;

/**
 * Devolve um token do Turnstile, pedindo o desafio se preciso.
 *
 * Um pedido por vez: se o assistente e a análise de importação pedirem juntos,
 * o segundo espera o primeiro em vez de abrir dois desafios sobrepostos.
 */
export async function requestTurnstileToken(): Promise<string> {
  const siteKey = turnstileSiteKey();
  if (!siteKey) throw new Error("Verificação não configurada neste ambiente.");
  const api = await loadTurnstile();

  return new Promise<string>((resolve, reject) => {
    const settle = (result: { token: string } | { error: string }) => {
      pending = null;
      if ("token" in result) resolve(result.token);
      else reject(new Error(result.error));
    };
    if (pending) {
      reject(new Error("Uma verificação já está em andamento."));
      return;
    }
    pending = settle;

    if (widgetId === null) {
      widgetId = api.render(container(), {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: (token) => pending?.({ token }),
        "error-callback": (code) =>
          pending?.({ error: code ? `Verificação falhou (${code}).` : "Verificação falhou." }),
        "timeout-callback": () => pending?.({ error: "A verificação expirou." }),
      });
    } else {
      // O token é de uso único, então o widget precisa ser zerado antes de
      // produzir outro; sem o reset, o execute devolve o token já gasto e o
      // servidor recusa.
      api.reset(widgetId);
    }
    api.execute(widgetId);
  });
}
