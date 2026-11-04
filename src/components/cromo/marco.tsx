import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { salir } from "@/app/sesion/acciones";

import { estadoDelMarco, type EmpresaDelMarco } from "./estado-marco";
import { IconoEntrar, IconoSalir } from "./iconos";
import { Banderin, PalabraArco } from "./logotipo";
import { LateralMovil } from "./lateral-movil";
import { seccionesDe, type Contador, type GrupoDeSecciones } from "./secciones";
import { SelectorTema } from "./selector-tema";
import { COOKIE_TEMA, temaDesde } from "./tema";

async function temaElegido() {
  return temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
}

/**
 * El portal del cliente: Arco Empresas. `empresa` y `contadores` solo se pasan
 * cuando la página no muestra la sesión (el muestrario); si no, los lee el marco.
 */
export async function Marco({
  actual,
  persona = null,
  maestro = false,
  poliza = false,
  proveedores = false,
  lista69b = false,
  empresa,
  contadores,
  children,
}: {
  actual: string;
  persona?: { nombre: string } | null;
  maestro?: boolean;
  poliza?: boolean;
  proveedores?: boolean;
  lista69b?: boolean;
  empresa?: EmpresaDelMarco | null;
  contadores?: Record<string, Contador>;
  children: ReactNode;
}) {
  const [tema, leido] = await Promise.all([
    temaElegido(),
    empresa === undefined ? estadoDelMarco() : Promise.resolve({ empresa, contadores: contadores ?? {} }),
  ]);
  const grupos = seccionesDe({ maestro, poliza, proveedores, lista69b });

  return (
    <div className="marco">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <LateralMovil marca={<Marca linea="Empresas" />}>
        <div className="lateral-cabeza">
          <Marca linea="Empresas" />
        </div>
        {leido.empresa ? <EmpresaLateral empresa={leido.empresa} /> : null}
        <nav className="secciones" aria-label="Secciones">
          {grupos.map((grupo) => (
            <Grupo key={grupo.titulo} grupo={grupo} actual={actual} contadores={leido.contadores} />
          ))}
        </nav>
        <div className="lateral-pie">
          <SelectorTema inicial={tema} />
          {persona ? (
            <div className="quien">
              <span className="quien-inicial" aria-hidden="true">
                {inicialesDe(persona.nombre)}
              </span>
              <p>
                <span className="quien-nombre">{persona.nombre}</span>
                <span className="quien-etiqueta">Sesión abierta</span>
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

/** La app de quien paga. No lleva el menú, la empresa ni el pie del portal del cliente. */
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
            <p className="marca-app">
              <Banderin />
              <PalabraArco />
              <span className="solo-lector">Arco</span>
            </p>
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

function EmpresaLateral({ empresa }: { empresa: EmpresaDelMarco }) {
  return (
    <div className="empresa-lateral">
      <span className="empresa-iniciales" aria-hidden="true">
        {inicialesDe(empresa.razonSocial)}
      </span>
      <p>
        <span className="empresa-nombre">{empresa.razonSocial}</span>
        <span className="empresa-rfc">RFC {empresa.rfc}</span>
      </p>
    </div>
  );
}

function Grupo({
  grupo,
  actual,
  contadores,
}: {
  grupo: GrupoDeSecciones;
  actual: string;
  contadores: Record<string, Contador>;
}) {
  const id = `grupo-${grupo.titulo.toLocaleLowerCase("es-MX")}`;
  return (
    <div className="secciones-grupo">
      <p className="solo-lector" id={id}>
        {grupo.titulo}
      </p>
      <ul aria-labelledby={id}>
        {grupo.secciones.map(({ href, etiqueta, Icono }) => {
          const contador = contadores[href];
          return (
            <li key={href}>
              <Link href={href} className="seccion" aria-current={href === actual ? "page" : undefined}>
                <Icono />
                {etiqueta}
                {contador ? (
                  <span className="seccion-contador">
                    {contador.valor}
                    <span className="solo-lector">, {contador.etiqueta}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Marca({ linea }: { linea: string }) {
  return (
    <Link href="/consola" className="marca" aria-label={`Arco ${linea}, ir al resumen`}>
      <Banderin />
      <span className="marca-texto">
        <PalabraArco />
        <span className="marca-linea">{linea}</span>
      </span>
    </Link>
  );
}

function Pie() {
  return (
    <footer className="pie">
      <p>El saldo vive con el participante de la CLABE. El plástico vive con el emisor.</p>
    </footer>
  );
}

function inicialesDe(nombre: string): string {
  const palabras = nombre
    .trim()
    .split(/\s+/)
    .filter((palabra) => /^\p{L}/u.test(palabra) && palabra.length > 2);
  const letras = (palabras.length ? palabras : [nombre.trim()])
    .slice(0, 2)
    .map((palabra) => palabra.charAt(0).toLocaleUpperCase("es-MX"))
    .join("");
  return letras || "·";
}
