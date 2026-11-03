import Link from "next/link";

import { salir } from "@/app/sesion/acciones";

const FINANZAS = [
  { href: "/", etiqueta: "Alta" },
  { href: "/precios", etiqueta: "Precios" },
  { href: "/consola", etiqueta: "Consola" },
  { href: "/consola/politica", etiqueta: "Política" },
] as const;

export function Encabezado({
  actual,
  persona = null,
  superficie = "finanzas",
  maestro = false,
}: {
  actual: string;
  persona?: { nombre: string } | null;
  superficie?: "finanzas" | "telefono";
  maestro?: boolean;
}) {
  const finanzas = maestro ? [...FINANZAS, { href: "/consola/personas", etiqueta: "Personas" }] : FINANZAS;
  return (
    <header className="encabezado">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <div className="encabezado-interior">
        {superficie === "telefono" ? (
          <span className="marca">
            <Sello />
            Plataforma
          </span>
        ) : (
          <Link href="/" className="marca">
            <Sello />
            Plataforma
          </Link>
        )}
        {superficie === "finanzas" ? (
          <div className="encabezado-acciones">
            <nav aria-label="Finanzas">
              <ul>
                {finanzas.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={item.href === actual ? "page" : undefined}>
                      {item.etiqueta}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {persona ? (
              <div className="quien">
                <p>
                  Entraste como <span>{persona.nombre}</span>
                </p>
                <form action={salir}>
                  <button type="submit" className="salir">
                    Salir
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function Sello() {
  return (
    <span className="marca-sello" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="22" height="22">
        <rect width="32" height="32" fill="#f4f1ea" />
        <rect x="5" y="5" width="22" height="22" fill="#0c5c48" />
        <path d="M15 5h2v22h-2z" fill="#f4f1ea" />
      </svg>
    </span>
  );
}

export function Pie() {
  return (
    <footer className="pie">
      <p>El saldo vive con el participante de la CLABE. El plástico vive con el emisor.</p>
    </footer>
  );
}
