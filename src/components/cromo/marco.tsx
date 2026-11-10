import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { salir } from "@/app/sesion/acciones";
import { AcentoInicial } from "@/components/apariencia/acento-inicial";
import { AparienciaViva } from "@/components/apariencia/viva";
import { BotonEnviar } from "@/components/sistema/boton-enviar";
import { enEmpresa, rutaConsola } from "@/nucleo/rutas";

import { BarraSuperior } from "./barra-superior";
import { estadoDelMarco, type EmpresaDelMarco } from "./estado-marco";
import {
  IconoApariencia,
  IconoBuscar,
  IconoEmpresas,
  IconoEntrar,
  IconoInicio,
  IconoPolitica,
  IconoPoliza,
  IconoSalir,
  IconoSeguridad,
} from "./iconos";
import { LateralMovil } from "./lateral-movil";
import { Logotipo } from "./logotipo";
import { MenuDesplegable } from "./menu-desplegable";
import { ProgresoEnlace } from "./progreso-enlace";
import { MARCO_SIN_SESION, MODULOS_DEL_DISENO, puertasDe, type EmpresaElegible, type Puertas, type VistaDeMarco } from "./puertas";
import { masDe, seccionActual, seccionesDe, type Contador, type GrupoDeSecciones, type Seccion } from "./secciones";
import { COOKIE_TEMA, temaDesde } from "./tema";

/**
 * El único pie regulatorio de la plataforma: lo usan el lateral y, en pantallas angostas, el final de cada página.
 * Es el aviso vigente hasta que legal apruebe el texto nuevo (decisión de Gil); cambiarlo es cambiar esta constante.
 */
export const PIE_REGULATORIO = "El saldo vive con el participante de la CLABE. El plástico vive con el emisor.";

/** Títulos de las páginas que no están en el menú lateral, o que viven dentro de otra sección. */
const TITULOS_FUERA_DEL_MENU: Record<string, string> = {
  "/consola/apariencia": "Apariencia",
  "/consola/perfil": "Mi perfil",
  "/consola/configuracion": "Configuración",
  "/consola/politica": "Políticas",
  "/consola/integraciones": "Integraciones",
  "/consola/personas": "Personas y nómina",
  "/consola/lista-69b": "Lista 69-B",
  "/consola/poliza": "Póliza",
  "/empresas": "Empresas",
  "/precios": "Precios",
  "/entrar": "Entrar",
  "/invitacion": "Invitación",
};

async function temaElegido() {
  return temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
}

/**
 * El portal del cliente: la escena detrás, el lateral (marca, empresa, secciones y
 * pie regulatorio) y la barra de arriba (título, búsqueda, acción de la página y
 * menú de la persona). `vista` sale de la tenencia. El muestrario pasa la empresa a mano.
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
  titulo,
  accion,
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
  /** Título de la barra; sin él, el nombre de la sección actual. */
  titulo?: string;
  /** La acción principal de la página, a la derecha de la barra (opcional). */
  accion?: ReactNode;
  children: ReactNode;
}) {
  const deMuestra = empresa !== undefined || maestro || poliza || proveedores || lista69b;
  const tema = await temaElegido();
  const leido = deMuestra
    ? { empresa: empresa ?? null, contadores: contadores ?? {} }
    : await estadoDelMarco();
  const puertas: Puertas = deMuestra
    ? {
        consola: true,
        resumen: true,
        politica: true,
        maestro,
        poliza,
        proveedores,
        lista69b,
        configuracion: true,
        telefono: false,
        flujo: false,
        modulos: Object.fromEntries(MODULOS_DEL_DISENO.map((ruta) => [ruta, false])) as Puertas["modulos"],
      }
    : puertasDe(vista.capacidades);
  const empresaDeEnlaces = deMuestra ? null : vista.empresaId;
  const grupos = seccionesDe(puertas, empresaDeEnlaces);
  const mas = masDe(puertas, empresaDeEnlaces);
  const quien = deMuestra ? (persona ? { id: undefined, nombre: persona.nombre, rol: null } : null) : vista.persona;
  // Sin cifras, la consola abre en Aprobaciones (antes Pendientes).
  const destinoConsola = deMuestra ? "/consola" : rutaConsola(vista.capacidades);
  const exacta = [...grupos, ...mas].flatMap((grupo) => grupo.secciones).find((seccion) => seccion.ruta === actual);
  const tituloVisible =
    titulo ?? exacta?.etiqueta ?? TITULOS_FUERA_DEL_MENU[actual] ?? seccionActual(grupos, actual)?.etiqueta ?? "";
  const marcada = seccionActual(grupos, actual)?.ruta ?? null;
  const busqueda = puertas.maestro
    ? { accion: enEmpresa(vista.empresaId, "/consola/personas"), texto: "Buscar persona", vista: null }
    : puertas.proveedores
      ? { accion: enEmpresa(vista.empresaId, "/consola/proveedores"), texto: "Buscar proveedor", vista: "proveedores" }
      : null;

  return (
    <>
      <AcentoInicial persona={quien?.id} tema={tema} />
      <AparienciaViva persona={quien?.id} tema={tema} />
      <div className="marco">
        <a className="saltar" href="#contenido">
          Saltar al contenido
        </a>
        <LateralMovil marca={<Marca empresaId={vista.empresaId} destino={destinoConsola} />}>
          <div className="lateral-cabeza">
            <Marca empresaId={vista.empresaId} destino={destinoConsola} />
          </div>
          {leido.empresa ? (
            <EmpresaLateral empresa={leido.empresa} empresas={vista.empresas} actual={vista.empresaId} mas={mas} rutaActual={actual} />
          ) : null}
          <nav className="secciones" aria-label="Secciones">
            {grupos.map((grupo) => (
              <Grupo key={grupo.titulo} grupo={grupo} marcada={marcada} contadores={leido.contadores} />
            ))}
          </nav>
          <p className="lateral-pie">{PIE_REGULATORIO}</p>
        </LateralMovil>
        <div className="lienzo">
          <BarraSuperior>
            <p className="barra-titulo">{tituloVisible}</p>
            <span className="barra-espacio" />
            {busqueda ? (
              <form className="busqueda" role="search" aria-label={busqueda.texto} action={busqueda.accion}>
                <IconoBuscar />
                {busqueda.vista ? <input type="hidden" name="vista" value={busqueda.vista} /> : null}
                <input type="search" name="q" maxLength={100} placeholder={busqueda.texto} aria-label={busqueda.texto} autoComplete="off" />
              </form>
            ) : null}
            {accion}
            {quien ? (
              <>
                <MenuPersona
                  nombre={quien.nombre}
                  rol={quien.rol}
                  apariencia={vista.empresaId ? enEmpresa(vista.empresaId, "/consola/apariencia") : null}
                  cambiarEmpresa={vista.variasEmpresas}
                />
                {/* Sin JavaScript el menú de la persona no abre: «Salir» queda a la vista, con la misma acción. */}
                <noscript>
                  <form action={salir} className="salir-sin-script">
                    <button type="submit" className="boton-secundario">
                      <IconoSalir />
                      Salir
                    </button>
                  </form>
                </noscript>
              </>
            ) : (
              <Link href="/entrar" className="boton-secundario barra-entrar" aria-current={actual === "/entrar" ? "page" : undefined}>
                <IconoEntrar />
                Entrar
              </Link>
            )}
          </BarraSuperior>
          {children}
          {/* En pantallas angostas el lateral es un cajón: el aviso regulatorio no se esconde ahí, va al final de la página,
              como su pie. */}
          <footer className="pie-movil">{PIE_REGULATORIO}</footer>
        </div>
      </div>
    </>
  );
}

/**
 * La tarjeta de la empresa abre «Más», como el menú de la empresa del diseño:
 * Tú (perfil, apariencia, teléfono), Empresa (configuración, políticas,
 * integraciones) y, si la persona tiene varias, sus empresas.
 */
function EmpresaLateral({
  empresa,
  empresas,
  actual,
  mas,
  rutaActual,
}: {
  empresa: EmpresaDelMarco;
  empresas: readonly EmpresaElegible[];
  actual: string | null;
  mas: readonly GrupoDeSecciones[];
  rutaActual: string;
}) {
  const tarjeta = (
    <>
      <span className="empresa-iniciales" aria-hidden="true">
        {inicialesDe(empresa.razonSocial)}
      </span>
      <span className="empresa-datos">
        <span className="empresa-nombre">{empresa.razonSocial}</span>
        <span className="empresa-rfc">RFC {empresa.rfc}</span>
      </span>
    </>
  );
  if (empresas.length < 2 && mas.length === 0) return <div className="empresa-lateral">{tarjeta}</div>;
  return (
    <MenuDesplegable
      clase="empresa-lateral"
      etiqueta="Más: tu perfil y tu empresa"
      disparador={
        <>
          {/* El botón se anuncia como lo que abre; la tarjeta sola diría solo el nombre de la empresa. */}
          <span className="solo-lector">Más: tu perfil y tu empresa. </span>
          {tarjeta}
        </>
      }
      fijo
    >
      {mas.map((grupo) => (
        <div key={grupo.titulo} className="menu-grupo">
          <p className="menu-seccion">{grupo.titulo}</p>
          {grupo.secciones.map((seccion: Seccion) => (
            <Link
              key={seccion.href}
              href={seccion.href}
              role="menuitem"
              tabIndex={-1}
              className="menu-opcion"
              aria-current={seccion.ruta === rutaActual ? "page" : undefined}
            >
              <seccion.Icono />
              {seccion.etiqueta}
            </Link>
          ))}
        </div>
      ))}
      {empresas.length > 1 ? (
        <>
          <p className="menu-seccion">Tus empresas</p>
          {empresas.map((otra) => (
            <Link
              key={otra.id}
              href={otra.destino}
              role="menuitem"
              tabIndex={-1}
              className="menu-opcion"
              aria-current={otra.id === actual ? "true" : undefined}
            >
              <span className="menu-iniciales" aria-hidden="true">
                {inicialesDe(otra.razonSocial)}
              </span>
              {otra.razonSocial}
            </Link>
          ))}
        </>
      ) : null}
    </MenuDesplegable>
  );
}

function MenuPersona({
  nombre,
  rol,
  apariencia,
  cambiarEmpresa,
}: {
  nombre: string;
  rol: string | null;
  /** Sin empresa elegida (en /empresas) no hay Apariencia a la cual ir. */
  apariencia: string | null;
  cambiarEmpresa: boolean;
}) {
  return (
    <MenuDesplegable
      clase="cuenta"
      etiqueta="Tu cuenta"
      disparador={
        <>
          <span className="persona-iniciales" aria-hidden="true">
            {inicialesDe(nombre)}
          </span>
          <span className="persona-datos">
            <span className="persona-nombre">{nombre}</span>
            {rol ? <span className="persona-rol">{rol}</span> : null}
          </span>
        </>
      }
    >
      <p className="menu-seccion">Tú</p>
      <Link href="/entrar/seguridad" role="menuitem" tabIndex={-1} className="menu-opcion">
        <IconoSeguridad />
        Mi perfil y seguridad
      </Link>
      {apariencia ? (
        <Link href={apariencia} role="menuitem" tabIndex={-1} className="menu-opcion">
          <IconoApariencia />
          Apariencia
        </Link>
      ) : null}
      {cambiarEmpresa ? (
        <>
          <p className="menu-seccion">Empresa</p>
          <Link href="/empresas" role="menuitem" tabIndex={-1} className="menu-opcion">
            <IconoEmpresas />
            Cambiar de empresa
          </Link>
        </>
      ) : null}
      <form action={salir} className="menu-pie">
        <button type="submit" role="menuitem" tabIndex={-1} className="menu-opcion">
          <IconoSalir />
          Salir
        </button>
      </form>
    </MenuDesplegable>
  );
}

function Grupo({
  grupo,
  marcada,
  contadores,
}: {
  grupo: GrupoDeSecciones;
  /** La ruta de la sección actual: la de la página o la que la incluye. */
  marcada: string | null;
  contadores: Record<string, Contador>;
}) {
  const id = `grupo-${grupo.titulo.toLocaleLowerCase("es-MX")}`;
  return (
    <div className="secciones-grupo">
      <p className="solo-lector" id={id}>
        {grupo.titulo}
      </p>
      <ul aria-labelledby={id}>
        {grupo.secciones.map(({ ruta, href, etiqueta, Icono, incluye }) => {
          // El contador de una página que vive dentro de otra sección (Personas en Nómina) sube a ella.
          const contador = contadores[ruta] ?? incluye?.map((otra) => contadores[otra]).find(Boolean);
          return (
            <li key={href}>
              <Link href={href} className="seccion" prefetch={true} aria-current={ruta === marcada ? "page" : undefined}>
                <Icono />
                {etiqueta}
                {contador ? (
                  <span className="seccion-contador">
                    {contador.valor}
                    <span className="solo-lector">, {contador.etiqueta}</span>
                  </span>
                ) : null}
                <ProgresoEnlace />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Marca({ empresaId = null, destino }: { empresaId?: string | null; destino: "/consola" | "/consola/aprobaciones" }) {
  // El nombre sale del contenido, en un solo texto para el lector de pantalla que empieza con lo que se ve («Lever
  // Empresas»). Un `aria-label` en el enlace no contendría el texto visible (WCAG 2.5.3), y el texto junto al logotipo
  // con su propio nombre dejaría un espacio antes de la coma («Lever Empresas , ir a…»).
  return (
    <Link href={enEmpresa(empresaId, destino)} className="marca">
      <Logotipo decorativo />
      <span className="solo-lector">Lever Empresas, ir a {destino === "/consola" ? "Resumen" : "Aprobaciones"}</span>
    </Link>
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

/** Teléfono protegido y de solo lectura. Los enlaces conservan la empresa elegida. */
export async function MarcoTelefono({
  children,
  titulo,
  actual = "/telefono",
  empresaId = null,
  personaId,
  consola = false,
  resumen = false,
  variasEmpresas = false,
}: {
  children: ReactNode;
  /** Título de la barra en las pantallas internas; Inicio lleva el logotipo, como en el diseño. */
  titulo?: string;
  actual?: "/telefono" | "/telefono/topes" | "/telefono/facturacion";
  empresaId?: string | null;
  /** Para leer la apariencia de la persona (escena y tono). */
  personaId?: string;
  consola?: boolean;
  resumen?: boolean;
  variasEmpresas?: boolean;
}) {
  const tema = await temaElegido();
  const secciones = [
    { ruta: "/telefono", etiqueta: "Inicio", Icono: IconoInicio },
    { ruta: "/telefono/topes", etiqueta: "Topes", Icono: IconoPolitica },
    { ruta: "/telefono/facturacion", etiqueta: "Factura", Icono: IconoPoliza },
  ] as const;
  return (
    <>
      <AcentoInicial persona={personaId} tema={tema} />
      <AparienciaViva persona={personaId} tema={tema} />
      <div className="marco-telefono">
        <a className="saltar" href="#contenido">Saltar al contenido</a>
        <main id="contenido" className="superficie-telefono">
          <div className="telefono">
            <header className={titulo ? "telefono-cabeza telefono-cabeza-titulo" : "telefono-cabeza"}>
              {titulo ? <p className="telefono-titulo">{titulo}</p> : <p className="marca-app"><Logotipo linea={null} /></p>}
              <Link href={enEmpresa(empresaId, "/consola/apariencia")} className="enlace-apariencia">
                <IconoApariencia />
                Apariencia
              </Link>
            </header>
            <div className="telefono-cuerpo">{children}</div>
            <nav className="navegacion-app" aria-label="Teléfono">
              {secciones.map(({ ruta, etiqueta, Icono }) => (
                <Link key={ruta} href={enEmpresa(empresaId, ruta)} aria-current={actual === ruta ? "page" : undefined}>
                  <Icono />
                  {etiqueta}
                </Link>
              ))}
            </nav>
            <footer className="pie-app enlaces-app">
              {consola ? <Link href={enEmpresa(empresaId, resumen ? "/consola" : "/consola/aprobaciones")}>Abrir consola</Link> : null}
              {variasEmpresas ? <Link href="/empresas">Cambiar de empresa</Link> : null}
              <form action={salir}><BotonEnviar className="" enviando="Saliendo…">Salir</BotonEnviar></form>
            </footer>
          </div>
        </main>
      </div>
    </>
  );
}
