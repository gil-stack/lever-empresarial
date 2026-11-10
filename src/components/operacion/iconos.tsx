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

export function IconoCumplimiento() {
  return (
    <Trazo>
      <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6zM9 12l2 2 4-4" />
    </Trazo>
  );
}

export function IconoBloqueadas() {
  return (
    <Trazo>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8" />
    </Trazo>
  );
}

export function IconoPersonal() {
  return (
    <Trazo>
      <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.9 3 2.8 3 5" />
    </Trazo>
  );
}

export function IconoExpediente() {
  return (
    <Trazo>
      <path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM9 13h6M9 16h4" />
    </Trazo>
  );
}

export function IconoSuspension() {
  return (
    <Trazo>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 9v6M14 9v6" />
    </Trazo>
  );
}
