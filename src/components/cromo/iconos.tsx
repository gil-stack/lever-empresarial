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

export function IconoFlujo() {
  return (
    <Trazo>
      <path d="M3 17l5-5 4 4 8-9M15 7h5v5" />
    </Trazo>
  );
}

export function IconoCobros() {
  return (
    <Trazo>
      <path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3" />
    </Trazo>
  );
}

export function IconoCalendario() {
  return (
    <Trazo>
      <path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 3v4M16 3v4" />
    </Trazo>
  );
}

export function IconoPresupuestos() {
  return (
    <Trazo>
      <path d="M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z" />
    </Trazo>
  );
}

/* Los íconos de las secciones del diseño (fPlat: sync, receipt, card, list, bank, globe, up, grow, plane, fuel, spark, plug). */

export function IconoConciliacion() {
  return (
    <Trazo>
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" />
    </Trazo>
  );
}

export function IconoGastos() {
  return (
    <Trazo>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
    </Trazo>
  );
}

export function IconoTarjetas() {
  return (
    <Trazo>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h4" />
    </Trazo>
  );
}

export function IconoMovimientos() {
  return (
    <Trazo>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </Trazo>
  );
}

export function IconoCuenta() {
  return (
    <Trazo>
      <path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />
    </Trazo>
  );
}

export function IconoInternacional() {
  return (
    <Trazo>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
    </Trazo>
  );
}

export function IconoCredito() {
  return (
    <Trazo>
      <path d="M4 17 10 11l4 4 6-7M14 8h6v6" />
    </Trazo>
  );
}

export function IconoInversion() {
  return (
    <Trazo>
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </Trazo>
  );
}

export function IconoViajes() {
  return (
    <Trazo>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </Trazo>
  );
}

export function IconoGasolina() {
  return (
    <Trazo>
      <path d="M4 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20h12M4 10h10M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3" />
    </Trazo>
  );
}

export function IconoAhorro() {
  return (
    <Trazo>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </Trazo>
  );
}

export function IconoIntegraciones() {
  return (
    <Trazo>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5" />
    </Trazo>
  );
}

export function IconoDescargar() {
  return (
    <Trazo>
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
    </Trazo>
  );
}

export function IconoMas() {
  return (
    <Trazo>
      <path d="M12 5v14M5 12h14" />
    </Trazo>
  );
}

export function IconoAlerta() {
  return (
    <Trazo>
      <path d="M12 4 2 20h20zM12 10v4M12 17h.01" />
    </Trazo>
  );
}

export function IconoVehiculo() {
  return (
    <Trazo>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
    </Trazo>
  );
}

export function IconoCorreo() {
  return (
    <Trazo>
      <path d="M3 6h18v12H3zM3 7l9 6 9-6" />
    </Trazo>
  );
}

export function IconoCopiar() {
  return (
    <Trazo>
      <path d="M9 9h11v11H9zM5 15V4h11" />
    </Trazo>
  );
}
