import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { salir } from "@/app/sesion/acciones";
import { enEmpresa } from "@/nucleo/rutas";

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
          configuracion: true,
          telefono: false,
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
      <LateralMovil marca={<Marca linea="Empresas" empresaId={vista.empresaId} />}>
        <div className="lateral-cabeza">
          <Marca linea="Empresas" empresaId={vista.empresaId} />
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

/** Teléfono protegido y de solo lectura. Los enlaces conservan la empresa elegida. */
export async function MarcoTelefono({
  children,
  actual = "/telefono",
  empresaId = null,
  consola = false,
  variasEmpresas = false,
}: {
  children: ReactNode;
  actual?: "/telefono" | "/telefono/topes" | "/telefono/facturacion";
  empresaId?: string | null;
  consola?: boolean;
  variasEmpresas?: boolean;
}) {
  const tema = await temaElegido();
  const secciones = [
    { ruta: "/telefono", etiqueta: "Inicio" },
    { ruta: "/telefono/topes", etiqueta: "Topes" },
    { ruta: "/telefono/facturacion", etiqueta: "Facturación" },
  ] as const;
  return (
    <div className="marco-telefono">
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      <main id="contenido" className="superficie-telefono">
        <div className="telefono">
          <header className="telefono-cabeza">
            <p className="marca-app"><Banderin /><PalabraArco /><span className="solo-lector">Arco</span></p>
            <SelectorTema inicial={tema} />
          </header>
          <div className="telefono-cuerpo">{children}</div>
          <nav className="navegacion-app" aria-label="Teléfono">
            {secciones.map((seccion) => (
              <Link key={seccion.ruta} href={enEmpresa(empresaId, seccion.ruta)} aria-current={actual === seccion.ruta ? "page" : undefined}>
                {seccion.etiqueta}
              </Link>
            ))}
          </nav>
          <div className="enlaces-app">
            {consola ? <Link href={enEmpresa(empresaId, "/consola")}>Abrir consola</Link> : null}
            {variasEmpresas ? <Link href="/empresas">Cambiar de empresa</Link> : null}
            <form action={salir}><button type="submit">Salir</button></form>
          </div>
          <footer className="pie-app"><p>Consulta de solo lectura. No hay gastos, tarjetas ni movimientos de dinero en esta superficie.</p></footer>
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

function Marca({ linea, empresaId = null }: { linea: string; empresaId?: string | null }) {
  return (
    <Link href={enEmpresa(empresaId, "/consola")} className="marca" aria-label={`Arco ${linea}, ir a Pendientes`}>
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
