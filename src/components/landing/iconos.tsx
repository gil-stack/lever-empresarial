export type NombreIcono = "flecha" | "check" | "politica" | "firmas" | "proveedor" | "equipo";

export function Icono({ nombre, className = "" }: { nombre: NombreIcono; className?: string }) {
  return (
    <svg
      className={`arco-icono ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {nombre === "flecha" ? (
        <>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </>
      ) : null}
      {nombre === "check" ? <path d="m5 12 4 4L19 6" /> : null}
      {nombre === "politica" ? (
        <>
          <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="14" cy="18" r="2" />
        </>
      ) : null}
      {nombre === "firmas" ? (
        <>
          <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </>
      ) : null}
      {nombre === "proveedor" ? (
        <>
          <path d="M4 20V8l8-4 8 4v12" />
          <path d="M2 20h20M8 20v-5h8v5M8 9h.01M12 9h.01M16 9h.01M8 12h.01M12 12h.01M16 12h.01" />
        </>
      ) : null}
      {nombre === "equipo" ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-2a6 6 0 0 1 12 0v2" />
          <path d="M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 4 4.9V20" />
        </>
      ) : null}
    </svg>
  );
}
