import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { salir } from "@/app/sesion/acciones";

import { IconoEntrar, IconoSalir } from "./iconos";
import { LateralMovil } from "./lateral-movil";
import { seccionesDe, type GrupoDeSecciones } from "./secciones";
import { SelectorTema } from "./selector-tema";
import { COOKIE_TEMA, temaDesde } from "./tema";

async function temaElegido() {
  return temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
}

export async function Marco({
  actual,
  persona = null,
  maestro = false,
  poliza = false,
  proveedores = false,
  lista69b = false,
  children,
}: {
  actual: string;
  persona?: { nombre: string } | null;
  maestro?: boolean;
  poliza?: boolean;
  proveedores?: boolean;
  lista69b?: boolean;
  children: ReactNode;
}) {
  const tema = await temaElegido();
  const grupos = seccionesDe({ maestro, poliza, proveedores, lista69b });

  return (
    <div className="marco">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <LateralMovil marca={<Marca enlace />}>
        <div className="lateral-cabeza">
          <Marca enlace />
        </div>
        <nav className="secciones" aria-label="Finanzas">
          {grupos.map((grupo) => (
            <Grupo key={grupo.titulo} grupo={grupo} actual={actual} />
          ))}
        </nav>
        <div className="lateral-pie">
          <SelectorTema inicial={tema} />
          {persona ? (
            <div className="quien">
              <span className="quien-inicial" aria-hidden="true">
                {inicialDe(persona.nombre)}
              </span>
              <p>
                <span className="quien-etiqueta">Entraste como </span>
                <span className="quien-nombre">{persona.nombre}</span>
                <Link href="/entrar/seguridad" className="quien-factor">
                  Segundo factor
                </Link>
              </p>
              <form action={salir}>
                <button type="submit" className="salir">
                  <IconoSalir />
                  Salir
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/entrar"
              className="seccion"
              aria-current={actual === "/entrar" ? "page" : undefined}
            >
              <IconoEntrar />
              Entrar
            </Link>
          )}
        </div>
      </LateralMovil>
      <div className="lienzo">
        {children}
        <Pie />
      </div>
    </div>
  );
}

/** La app de quien paga. No lleva el menú de la consola ni el pie del escritorio. */
export async function MarcoTelefono({ children }: { children: ReactNode }) {
  const tema = await temaElegido();
  return (
    <div className="marco-telefono">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <main id="contenido" className="superficie-telefono">
        <div className="telefono">
          <header className="telefono-cabeza">
            <p className="marca-app">Gasto</p>
            <SelectorTema inicial={tema} />
          </header>
          <div className="telefono-cuerpo">{children}</div>
          <footer className="pie-app">
            <p>Aquí se cierra un gasto. El escritorio de finanzas es otra pantalla.</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Grupo({ grupo, actual }: { grupo: GrupoDeSecciones; actual: string }) {
  return (
    <div className="secciones-grupo">
      <p className="secciones-titulo">{grupo.titulo}</p>
      <ul>
        {grupo.secciones.map(({ href, etiqueta, Icono }) => (
          <li key={href}>
            <Link href={href} className="seccion" aria-current={href === actual ? "page" : undefined}>
              <Icono />
              {etiqueta}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Marca({ enlace = false }: { enlace?: boolean }) {
  const contenido = (
    <>
      <Sello />
      Plataforma
    </>
  );
  return enlace ? (
    <Link href="/" className="marca">
      {contenido}
    </Link>
  ) : (
    <span className="marca">{contenido}</span>
  );
}

function Sello() {
  return (
    <span className="marca-sello" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="24" height="24">
        <rect className="sello-fondo" x="0" y="0" width="32" height="32" rx="7" />
        <rect className="sello-hoja" x="8" y="8" width="16" height="16" rx="1.5" />
        <path className="sello-fondo" d="M15 8h2v16h-2z" />
      </svg>
    </span>
  );
}

function Pie() {
  return (
    <footer className="pie">
      <p>El saldo vive con el participante de la CLABE. El plástico vive con el emisor.</p>
    </footer>
  );
}

function inicialDe(nombre: string): string {
  return nombre.trim().charAt(0).toLocaleUpperCase("es-MX") || "·";
}
