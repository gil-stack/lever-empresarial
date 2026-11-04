import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { puertasDe } from "@/components/cromo/puertas";
import { PanelLista69b } from "@/components/lista-69b/panel";
import { CabezaPagina } from "@/components/sistema";
import { sesionDesdeCookie } from "@/server/entrada";
import { esOperadorActual } from "@/server/precio";
import { leerVista69b, puedeAbrirLista69b, type VistaLista69b } from "@/server/lista-69b";
import { ErrorDeDominio, type Rol, type Sesion } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Lista 69-B",
};

type Carga =
  | { tipo: "sin_sesion" }
  | { tipo: "ajena"; nombre: string; rol: Rol | null; conEmpresa: boolean }
  | { tipo: "sin_empresa"; nombre: string; rol: Rol | null }
  | { tipo: "aviso"; mensaje: string; nombre: string | null; rol: Rol | null; conEmpresa: boolean }
  | { tipo: "lista"; nombre: string; rol: Rol | null; conEmpresa: boolean; vista: VistaLista69b };

export default async function PaginaLista69b({
  searchParams,
}: {
  searchParams: Promise<{ rfc?: string | string[] }>;
}) {
  const params = await searchParams;
  const rfc = typeof params.rfc === "string" ? params.rfc : null;
  const carga = await cargar(rfc);
  const persona = carga.tipo === "sin_sesion" || !carga.nombre ? null : { nombre: carga.nombre };
  const rol = carga.tipo === "sin_sesion" ? null : carga.rol;
  const conEmpresa = carga.tipo === "sin_sesion" || carga.tipo === "sin_empresa" ? false : carga.conEmpresa;

  return (
    <Marco actual="/consola/lista-69b" persona={persona} {...puertasDe(rol, conEmpresa)}>
      <main id="contenido" className="pagina">
        {carga.tipo === "lista" ? (
          <>
            <CabezaPagina kicker="Lista 69-B" titulo="Listado del artículo 69-B">
              <p className="lede">
                El SAT publica este listado. Si el RFC está en el archivo, el proveedor puede existir y el pago no.
                Si todavía no hay archivo, tampoco hay pago.
              </p>
            </CabezaPagina>
            <PanelLista69b vista={carga.vista} />
          </>
        ) : (
          <CabezaPagina kicker="Lista 69-B" titulo={titulo(carga)}>
            <p className="lede">{detalle(carga)}</p>
            {carga.tipo === "sin_sesion" ? (
              <div className="acciones">
                <Link className="boton" href="/entrar">
                  Entrar
                </Link>
              </div>
            ) : null}
          </CabezaPagina>
        )}
      </main>
    </Marco>
  );
}

async function cargar(rfc: string | null): Promise<Carga> {
  let sesion: Sesion | null = null;
  try {
    sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "sin_sesion" };
    const esOperador = esOperadorActual(sesion);
    if (!puedeAbrirLista69b(sesion, esOperador)) {
      return {
        tipo: "ajena",
        nombre: sesion.usuario.nombre,
        rol: sesion.rol,
        conEmpresa: Boolean(sesion.companyId),
      };
    }
    if (!sesion.companyId && !esOperador) {
      return { tipo: "sin_empresa", nombre: sesion.usuario.nombre, rol: sesion.rol };
    }
    const vista = await leerVista69b(sesion, rfc, { esOperador });
    return {
      tipo: "lista",
      nombre: sesion.usuario.nombre,
      rol: sesion.rol,
      conEmpresa: Boolean(sesion.companyId),
      vista,
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return {
        tipo: "aviso",
        mensaje: "No se pudo consultar el listado.",
        nombre: sesion?.usuario.nombre ?? null,
        rol: sesion?.rol ?? null,
        conEmpresa: Boolean(sesion?.companyId),
      };
    }
    throw error;
  }
}

function titulo(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_sesion") return "Hay que entrar.";
  if (carga.tipo === "sin_empresa") return "Todavía no hay razón social.";
  if (carga.tipo === "ajena") return "Esta lista es de la consola.";
  return "No se pudo consultar el listado.";
}

function detalle(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_sesion") return "La lista 69-B se consulta con la sesión de la empresa.";
  if (carga.tipo === "sin_empresa") return "Primero hace falta la razón social de la cuenta.";
  if (carga.tipo === "ajena") {
    return "El listado 69-B y el bloqueo de pago son de la plataforma administradora. La app del teléfono no los muestra.";
  }
  return carga.mensaje;
}
