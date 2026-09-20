import { useEffect } from "react";

/** Keys are compared case-insensitively, e.g. "f1" or "ctrl+r". */
export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function comboOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

/**
 * Global accelerator handler. Views stay in charge of their own actions; the
 * shell only owns navigation-level shortcuts.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const combo = comboOf(event);
      const action = map[combo];
      if (!action) return;
      // Never hijack typing inside inputs unless the shortcut has modifiers.
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const hasModifier = combo.includes("ctrl") || combo.includes("alt") || combo.includes("shift");
      if (typing && !hasModifier && !/^f\d+$/.test(combo)) return;
      event.preventDefault();
      action(event);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [map, enabled]);
}
