"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { COOKIE_TEMA } from "@/components/cromo/tema";

import { acentoPorTema, esTema, type ClaveTema } from "./catalogo";
import { FondoEscena } from "./fondo-escena";
import { claveDe, guardarPreferencias, leerPreferencias, type PreferenciasApariencia } from "./preferencias";

/** Aviso entre la página de Apariencia, el selector de tema y el fondo de la misma pestaña. */
const EVENTO = "lever:apariencia";

function suscribir(aviso: () => void) {
  window.addEventListener(EVENTO, aviso);
  window.addEventListener("storage", aviso);
  return () => {
    window.removeEventListener(EVENTO, aviso);
    window.removeEventListener("storage", aviso);
  };
}

function crudoDe(persona: string | undefined): string | null {
  try {
    return globalThis.localStorage?.getItem(claveDe(persona)) ?? null;
  } catch {
    return null;
  }
}

/**
 * El tema vive en la cookie (el servidor pinta el primer cuadro con él) y en
 * `data-tema`; escena, tono, luz y movimiento, en el navegador de cada persona.
 */
export function useApariencia(persona: string | undefined, temaInicial: ClaveTema) {
  const tema = useSyncExternalStore(
    suscribir,
    () => {
      const actual = document.documentElement.dataset.tema;
      return esTema(actual) ? actual : temaInicial;
    },
    () => temaInicial,
  );
  const crudo = useSyncExternalStore(
    suscribir,
    () => crudoDe(persona),
    () => null,
  );
  const preferencias = useMemo(
    () => ({ ...leerPreferencias(persona, { getItem: () => crudo, setItem: () => {} }), tema }),
    [persona, crudo, tema],
  );
  return preferencias;
}

/** Cambia el tema en la página y en la cookie, sin recargar. */
export function fijarTema(tema: ClaveTema): void {
  document.documentElement.dataset.tema = tema;
  document.cookie = `${COOKIE_TEMA}=${tema}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(EVENTO));
}

/** Guarda la apariencia de la persona y avisa al fondo. Devuelve `false` si el navegador no dejó guardar. */
export function guardarApariencia(preferencias: PreferenciasApariencia, persona: string | undefined): boolean {
  const guardado = guardarPreferencias(preferencias, persona);
  window.dispatchEvent(new Event(EVENTO));
  return guardado;
}

/**
 * El fondo animado de la superficie y el acento de su tono (applyPal del diseño).
 * Va detrás de todo el contenido; sin JavaScript queda el color liso del tema.
 */
export function AparienciaViva({ persona, tema: temaInicial }: { persona?: string; tema: ClaveTema }) {
  const { tema, escena, tono, colorPropio, movimiento, luzDinamica } = useApariencia(persona, temaInicial);

  useEffect(() => {
    const { acento, tinta } = acentoPorTema(tema, tono, colorPropio);
    const raiz = document.documentElement.style;
    raiz.setProperty("--acc", acento);
    raiz.setProperty("--ink", tinta);
  }, [tema, tono, colorPropio]);

  return (
    <FondoEscena
      escena={escena}
      tono={tono}
      tema={tema}
      movimiento={movimiento}
      luzDinamica={luzDinamica}
      colorPropio={colorPropio}
    />
  );
}
