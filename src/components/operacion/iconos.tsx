import type { ReactNode } from "react";

/** Los íconos de Operación que no tiene la consola, con el mismo trazo (1.4, redondo, caja de 24). */
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

export function IconoAlertas() {
  return (
    <Trazo>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
    </Trazo>
  );
}

export function IconoComisiones() {
  return (
    <Trazo>
      <path d="M19 5 5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
    </Trazo>
  );
}

export function IconoRecuperaciones() {
  return (
    <Trazo>
      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l2.5 2.5" />
    </Trazo>
  );
}

export function IconoBitacora() {
  return (
    <Trazo>
      <path d="M6 3h10l3 3v15H6zM9 9h7M9 13h7M9 17h4" />
    </Trazo>
  );
}

export function IconoActivacion() {
  return (
    <Trazo>
      <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6M3 20h18" />
    </Trazo>
  );
}

export function IconoPrecios() {
  return (
    <Trazo>
      <path d="M4 12.6V5.5A1.5 1.5 0 0 1 5.5 4h7.1l7.4 7.4-8.6 8.6zM8.5 8.5h.01" />
    </Trazo>
  );
}
