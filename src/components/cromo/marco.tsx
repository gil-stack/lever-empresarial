import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { salir } from "@/app/sesion/acciones";

import { estadoDelMarco, type EmpresaDelMarco } from "./estado-marco";
import { IconoEntrar, IconoSalir } from "./iconos";
import { Banderin, PalabraArco } from "./logotipo";
import { LateralMovil } from "./lateral-movil";
import { MARCO_SIN_SESION, puertasDe, type VistaDeMarco } from "./puertas";
import { seccionesDe, type Contador, type GrupoDeSecciones } from "./secciones";
import { SelectorTema } from "./selector-tema";
import { COOKIE_TEMA, temaDesde } from "./tema";

async function temaElegido() {
  return temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
}

/**
 * El portal del cliente: banderín, palabra y la línea «Empresas».
 * `vista` sale de la tenencia. El muestrario pasa la empresa a mano.
 */
export async function Marco({
  actual,
  vista = MARCO_SIN_SESION,
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
  vista?: VistaDeMarco;
  persona?: { nombre: string } | null;
  maestro?: boolean;
  poliza?: boolean;
  proveedores?: boolean;
  lista69b?: boolean;
  empresa?: EmpresaDelMarco | null;
  contadores?: Record<string, Contador>;
  children: ReactNode;
}) {
  const deMuestra = empresa !== undefined || maestro || poliza || proveedores || lista69b;
  const tema = await temaElegido();
  const leido = deMuestra
    ? { empresa: empresa ?? null, contadores: contadores ?? {} }
    : await estadoDelMarco();
  const grupos = deMuestra
    ? seccionesDe(
        {
          consola: true,
          politica: true,
          maestro,
          poliza,
          proveedores,
          lista69b,
          precios: true,
        },
        null,
        false,
      )
    : seccionesDe(puertasDe(vista.capacidades), vista.empresaId, vista.variasEmpresas);
  const quien = deMuestra ? persona : vista.persona;

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
          {quien ? (
            <div className="quien">
              <span className="quien-inicial" aria-hidden="true">
                {inicialesDe(quien.nombre)}
              </span>
              <p>
                <span className="quien-nombre">{quien.nombre}</span>
                {vista.razonSocial ? <span className="quien-etiqueta">{vista.razonSocial}</span> : null}
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
            <Link href="/entrar" className="seccion" aria-current={actual === "/entrar" ? "page" : undefined}>
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

/** La app de quien paga. Solo el logotipo, sin la línea «Empresas». */
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
        {grupo.secciones.map(({ ruta, href, etiqueta, Icono }) => {
          const contador = contadores[ruta];
          return (
            <li key={href}>
              <Link href={href} className="seccion" aria-current={ruta === actual ? "page" : undefined}>
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
