import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { puertasDe } from "@/components/cromo/puertas";
import { CabezaPagina } from "@/components/sistema";
import { sesionDesdeCookie } from "@/server/entrada";
import { entrarAPoliza } from "@/server/roles/servicio";
import { ErrorDeDominio, type Rol } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Póliza",
};

type Carga =
  | { tipo: "entrar" }
  | { tipo: "abierta"; nombre: string; rol: Rol | null }
  | { tipo: "ajena"; nombre: string; rol: Rol | null }
  | { tipo: "aviso"; nombre: string | null; rol: Rol | null; mensaje: string };

export default async function PaginaPoliza() {
  const carga = await cargar();
  const persona = carga.tipo === "entrar" ? null : carga.nombre ? { nombre: carga.nombre } : null;
  const puertas = puertasDe(carga.tipo === "entrar" ? null : carga.rol, carga.tipo === "abierta" || carga.tipo === "ajena");

  return (
    <Marco actual="/consola/poliza" persona={persona} {...puertas}>
      <main id="contenido" className="consola">
        <CabezaPagina kicker="Póliza" titulo={titulo(carga)}>
          <p className="lede">{detalle(carga)}</p>
          {carga.tipo === "entrar" ? (
            <div className="acciones">
              <Link className="boton" href="/entrar">
                Entrar
              </Link>
            </div>
          ) : null}
        </CabezaPagina>
      </main>
    </Marco>
  );
}

async function cargar(): Promise<Carga> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "entrar" };
    await entrarAPoliza(sesion);
    return { tipo: "abierta", nombre: sesion.usuario.nombre, rol: sesion.rol };
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    if (error.codigo === "sesion_ausente") return { tipo: "entrar" };
    try {
      const sesion = await sesionDesdeCookie();
      const nombre = sesion?.usuario.nombre ?? null;
      const rol = sesion?.rol ?? null;
      if (error.codigo === "sin_entrada_a_poliza" || error.codigo === "sin_membresia") {
        return { tipo: "ajena", nombre: nombre ?? "", rol };
      }
      if (error.codigo === "sin_empresa") {
        return { tipo: "aviso", nombre, rol, mensaje: "La póliza nace con la cuenta." };
      }
      return { tipo: "aviso", nombre, rol, mensaje: "No se pudo abrir la póliza." };
    } catch {
      return { tipo: "aviso", nombre: null, rol: null, mensaje: "No se pudo abrir la póliza." };
    }
  }
}

function titulo(carga: Carga): string {
  if (carga.tipo === "entrar") return "Hay que entrar.";
  if (carga.tipo === "abierta") return "Entrada del contador.";
  if (carga.tipo === "ajena") return "Esta entrada es del contador.";
  return "No se pudo abrir la póliza.";
}

function detalle(carga: Carga): string {
  if (carga.tipo === "entrar") return "La póliza se abre con la sesión de la empresa.";
  if (carga.tipo === "abierta") {
    return "Desde aquí se exporta la póliza. No se suelta dinero. En este corte no hay archivo: todavía no hay expedientes que cerrar.";
  }
  if (carga.tipo === "ajena") return "Quien administra y quien libera no entran por esta puerta.";
  return carga.mensaje;
}
