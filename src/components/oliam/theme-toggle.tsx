import { useEffect, useState } from "react";
import { THEME_KEY } from "@/lib/storage";

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const preferred =
      saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  return { theme, toggle };
}

export function ThemeToggle({
  theme,
  toggle,
  disabled,
}: {
  theme: string;
  toggle: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className="theme-switch shrink-0"
      title={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
    >
      <input
        type="checkbox"
        className="theme-switch__checkbox"
        checked={theme === "dark"}
        onChange={toggle}
        disabled={disabled}
        aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
      />
      <div className="theme-switch__container">
        <div className="theme-switch__clouds" />
        <div className="theme-switch__stars-container">
          <svg viewBox="0 0 55 33.4" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="4.5" r="1.1" />
            <circle cx="16" cy="12" r="0.8" />
            <circle cx="28" cy="3.5" r="1" />
            <circle cx="40.5" cy="13.5" r="0.7" />
            <circle cx="48" cy="5" r="1" />
            <circle cx="10" cy="21" r="0.7" />
            <circle cx="34.5" cy="23.5" r="0.9" />
            <circle cx="22" cy="26" r="0.6" />
          </svg>
        </div>
        <div className="theme-switch__circle-container">
          <div className="theme-switch__sun-moon-container">
            <div className="theme-switch__moon">
              <div className="theme-switch__spot" />
              <div className="theme-switch__spot" />
              <div className="theme-switch__spot" />
            </div>
          </div>
        </div>
      </div>
    </label>
  );
}
