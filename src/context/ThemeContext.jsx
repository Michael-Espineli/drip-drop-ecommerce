import { createContext, useContext, useEffect, useMemo, useState } from "react";

const THEME_STORAGE_KEY = "dripDropThemePreference";
const DEFAULT_THEME_PREFERENCE = "light";
const ThemeContext = createContext(null);

const getSystemTheme = () => {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const normalizePreference = (value) => (
  value === "dark" || value === "light" || value === "system" ? value : DEFAULT_THEME_PREFERENCE
);

const resolveTheme = (preference, systemTheme) => (
  preference === "system" ? systemTheme : normalizePreference(preference)
);

const getInitialThemePreference = () => {
  if (typeof window === "undefined") return DEFAULT_THEME_PREFERENCE;

  const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);

  return storedPreference === "system"
    ? DEFAULT_THEME_PREFERENCE
    : normalizePreference(storedPreference);
};

export const ThemeProvider = ({ children }) => {
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [themePreference, setThemePreference] = useState(getInitialThemePreference);

  const resolvedTheme = resolveTheme(themePreference, systemTheme);
  const isDarkMode = resolvedTheme === "dark";

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event) => setSystemTheme(event.matches ? "dark" : "light");

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    }
  }, [themePreference]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.classList.toggle("theme-dark", isDarkMode);
    root.classList.toggle("theme-light", !isDarkMode);
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [isDarkMode, resolvedTheme]);

  const value = useMemo(() => ({
    isDarkMode,
    resolvedTheme,
    setThemePreference,
    systemTheme,
    themePreference,
    toggleTheme: () => setThemePreference((current) => (resolveTheme(current, systemTheme) === "dark" ? "light" : "dark")),
  }), [isDarkMode, resolvedTheme, systemTheme, themePreference]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
};
