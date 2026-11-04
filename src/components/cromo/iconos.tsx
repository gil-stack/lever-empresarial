import type { ReactNode } from "react";

function Trazo({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icono"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconoConsola() {
  return (
    <Trazo>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Trazo>
  );
}

export function IconoPolitica() {
  return (
    <Trazo>
      <path d="M6 3.5h8.5L18.5 7.5V20.5H6z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9 12.5h6M9 16h4" />
    </Trazo>
  );
}

export function IconoPersonas() {
  return (
    <Trazo>
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.8-3.3 3.1-5 6-5s5.2 1.7 6 5" />
      <path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.8c1.5.6 2.6 2.2 3 4.7" />
    </Trazo>
  );
}

export function IconoPoliza() {
  return (
    <Trazo>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h12v15h-12A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21h12v-3" />
      <path d="M9 7.5h6M9 11h6" />
    </Trazo>
  );
}

export function IconoAlta() {
  return (
    <Trazo>
      <path d="M4 20.5h16" />
      <path d="M6 20.5V5.5l7-2v17" />
      <path d="M13 9.5h5v11" />
      <path d="M9 8.5v.01M9 12v.01M9 15.5v.01M16 13v.01M16 16.5v.01" />
    </Trazo>
  );
}

export function IconoPrecios() {
  return (
    <Trazo>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z" />
      <circle cx="8.5" cy="8.5" r="1.5" />
    </Trazo>
  );
}

export function IconoEntrar() {
  return (
    <Trazo>
      <path d="M13.5 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4" />
      <path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5" />
    </Trazo>
  );
}

export function IconoSalir() {
  return (
    <Trazo>
      <path d="M10.5 4.5h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h4" />
      <path d="M9.5 12h10M16 8.5l3.5 3.5-3.5 3.5" />
    </Trazo>
  );
}

export function IconoSol() {
  return (
    <Trazo>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Trazo>
  );
}

export function IconoLuna() {
  return (
    <Trazo>
      <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
    </Trazo>
  );
}

export function IconoAuto() {
  return (
    <Trazo>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" />
    </Trazo>
  );
}

export function IconoMenu() {
  return (
    <Trazo>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </Trazo>
  );
}

export function IconoCerrar() {
  return (
    <Trazo>
      <path d="M6 6l12 12M18 6 6 18" />
    </Trazo>
  );
}
