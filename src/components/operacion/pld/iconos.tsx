import type { ReactNode } from "react";

/** Íconos de las secciones de PLD, con el mismo trazo que ../iconos.tsx (1.4, redondo, caja de 24). */
function Trazo({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icono"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Alertas PLD: una lupa sobre un escudo. */
export function IconoAlertasPld() {
  return (
    <Trazo>
      <path d="M11 3.5 5 6v5c0 3.6 2.5 6.6 6 7.5" />
      <circle cx="15.5" cy="14.5" r="3.5" />
      <path d="m18 17 2.5 2.5" />
    </Trazo>
  );
}

/** Avisar a Cumplimiento: un sobre con una marca. */
export function IconoAvisoPld() {
  return (
    <Trazo>
      <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
      <path d="m4 7 8 6 8-6" />
    </Trazo>
  );
}

/** Comité: tres personas. */
export function IconoComite() {
  return (
    <Trazo>
      <circle cx="12" cy="8" r="2.5" />
      <circle cx="5.5" cy="10" r="2" />
      <circle cx="18.5" cy="10" r="2" />
      <path d="M7.5 19a4.5 4.5 0 0 1 9 0M2.5 18a3 3 0 0 1 4.5-2.6M21.5 18a3 3 0 0 0-4.5-2.6" />
    </Trazo>
  );
}

/** Reportes regulatorios: una hoja con renglones. */
export function IconoReportes() {
  return (
    <Trazo>
      <path d="M7 3.5h7l4 4v13H7z" />
      <path d="M14 3.5v4h4M9.5 12h6M9.5 15h6M9.5 18h4" />
    </Trazo>
  );
}

/** Conservación: una caja de archivo. */
export function IconoConservacion() {
  return (
    <Trazo>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12h4" />
    </Trazo>
  );
}
