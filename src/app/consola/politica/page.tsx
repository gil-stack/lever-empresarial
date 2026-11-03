import type { Metadata } from "next";

import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { PanelPolitica } from "@/components/politica/panel";
import type { VistaPolitica } from "@/dominio/politica";
import { sesionDesdeCookie } from "@/server/entrada";
import { leerPolitica } from "@/server/politica/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Política",
};

type Carga =
  | { tipo: "sin_sesion" }
  | { tipo: "sin_empresa"; nombre: string }
  | { tipo: "lista"; nombre: string; vista: VistaPolitica }
  | { tipo: "aviso"; mensaje: string };

export default async function PaginaPolitica() {
  const carga = await cargar();
  const persona = carga.tipo === "lista" || carga.tipo === "sin_empresa" ? { nombre: carga.nombre } : null;

  return (
    <>
      <Encabezado actual="/consola/politica" persona={persona} />
      <main id="contenido">
        {carga.tipo === "lista" ? (
          <PanelPolitica vista={carga.vista} />
        ) : (
          <div className="consola">
            <p className="kicker">Política</p>
            <h1>{titulo(carga)}</h1>
            <p className="lede">{detalle(carga)}</p>
          </div>
        )}
      </main>
      <Pie />
    </>
  );
}

async function cargar(): Promise<Carga> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "sin_sesion" };
    const vista = await leerPolitica(sesion);
    if (!vista) return { tipo: "sin_empresa", nombre: sesion.usuario.nombre };
    return { tipo: "lista", nombre: sesion.usuario.nombre, vista };
  } catch (error) {
    if (error instanceof ErrorDeDominio) return { tipo: "aviso", mensaje: mensajeLibro(error.codigo) };
    throw error;
  }
}

function titulo(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_sesion") return "Hay que entrar.";
  if (carga.tipo === "sin_empresa") return "Todavía no hay razón social.";
  return "No se pudo consultar la cuenta.";
}

function detalle(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_sesion") return "La política se ve después de entrar.";
  if (carga.tipo === "sin_empresa") return "La política nace con la cuenta.";
  return carga.mensaje;
}

function mensajeLibro(codigo: string): string {
  if (codigo === "politica_ausente") return "Esta cuenta todavía no tiene política en el libro.";
  if (codigo === "cajones_incompletos") return "Los cajones de esta cuenta no están completos.";
  return "No se pudieron leer la política ni los cajones.";
}
