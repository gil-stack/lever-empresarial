import type { ReactNode } from "react";

/** Íconos de trazo 1.4, redondos, sobre caja de 24: los del diseño de Lever Empresas. */
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

export function IconoInicio() {
  return (
    <Trazo>
      <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
    </Trazo>
  );
}

export function IconoPendientes() {
  return (
    <Trazo>
      <path d="m5 12 5 5 9-10" />
    </Trazo>
  );
}

export function IconoPolitica() {
  return (
    <Trazo>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
    </Trazo>
  );
}

export function IconoLista() {
  return (
    <Trazo>
      <path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8" />
    </Trazo>
  );
}

export function IconoPersonas() {
  return (
    <Trazo>
      <path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </Trazo>
  );
}

export function IconoPoliza() {
  return (
    <Trazo>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
    </Trazo>
  );
}

export function IconoConfiguracion() {
  return (
    <Trazo>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Trazo>
  );
}

export function IconoProveedores() {
  return (
    <Trazo>
      <path d="M3 9l1.5-5h15L21 9M3 9h18v11H3zM10 20v-5h4v5" />
    </Trazo>
  );
}

export function IconoTelefono() {
  return (
    <Trazo>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h4" />
    </Trazo>
  );
}

export function IconoEntrar() {
  return (
    <Trazo>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M14 17l5-5-5-5M19 12H8" />
    </Trazo>
  );
}

export function IconoSalir() {
  return (
    <Trazo>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
    </Trazo>
  );
}

export function IconoApariencia() {
  return (
    <Trazo>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4zM7.5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM10.5 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM15.5 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
    </Trazo>
  );
}

export function IconoSeguridad() {
  return (
    <Trazo>
      <path d="M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3" />
    </Trazo>
  );
}

export function IconoEmpresas() {
  return (
    <Trazo>
      <path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />
    </Trazo>
  );
}

export function IconoBuscar() {
  return (
    <Trazo>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Trazo>
  );
}

export function IconoChevron() {
  return (
    <Trazo>
      <path d="m6 9 6 6 6-6" />
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

export function IconoAumento() {
  return (
    <Trazo>
      <path d="M4 17 10 11l4 4 6-7M14 8h6v6" />
    </Trazo>
  );
}

export function IconoReembolso() {
  return (
    <Trazo>
      <path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />
    </Trazo>
  );
}

export function IconoCompra() {
  return (
    <Trazo>
      <path d="M3 9l1.5-5h15L21 9M3 9h18v11H3zM10 20v-5h4v5" />
    </Trazo>
  );
}
