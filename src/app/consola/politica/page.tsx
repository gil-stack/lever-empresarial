import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { PanelPolitica } from "@/components/politica/panel";
import { CabezaPagina } from "@/components/sistema";
import type { VistaPolitica } from "@/dominio/politica";
import type { ContextoDeTenant } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerPolitica } from "@/server/politica/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Política",
};

type Carga =
  | { tipo: "sin_empresa" }
  | { tipo: "sin_permiso" }
  | { tipo: "lista"; vista: VistaPolitica }
  | { tipo: "aviso"; mensaje: string };

export default async function PaginaPolitica() {
  const apertura = await abrirRuta("/consola/politica");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga =
    apertura.tipo === "libro"
      ? ({ tipo: "aviso", mensaje: "No se pudieron leer la política ni los cajones." } as const)
      : apertura.tipo === "sin_permiso"
        ? ({ tipo: "sin_permiso" } as const)
        : apertura.tipo === "sin_empresa" || !ctx
          ? ({ tipo: "sin_empresa" } as const)
          : await cargar(ctx);

  return (
    <Marco actual="/consola/politica" vista={vistaDeMarco(ctx)} titulo="Política">
      <main id="contenido">
        {carga.tipo === "lista" ? (
          <PanelPolitica vista={carga.vista} />
        ) : (
          <div className="consola">
            <CabezaPagina kicker="Política" titulo={titulo(carga)}>
              <p className="lede">{detalle(carga)}</p>
            </CabezaPagina>
          </div>
        )}
      </main>
    </Marco>
  );
}

async function cargar(ctx: ContextoDeTenant): Promise<Carga> {
  try {
    const vista = await leerPolitica(ctx);
    if (!vista) return { tipo: "sin_empresa" };
    return { tipo: "lista", vista };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) {
      return { tipo: "aviso", mensaje: mensajeLibro(error instanceof ErrorDeDominio ? error.codigo : "") };
    }
    throw error;
  }
}

function titulo(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_empresa") return "Elige una empresa.";
  if (carga.tipo === "sin_permiso") return "Tu rol no abre Política.";
  return "No se pudo abrir la política.";
}

function detalle(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_empresa") return "La política se abre dentro de una empresa.";
  if (carga.tipo === "sin_permiso") return "Pide acceso a quien administra la empresa.";
  return carga.mensaje;
}

function mensajeLibro(codigo: string): string {
  if (codigo === "politica_ausente") return "Esta cuenta todavía no tiene política en el libro.";
  if (codigo === "cajones_incompletos") return "Los cajones de esta cuenta no están completos.";
  return "No se pudieron leer la política ni los cajones.";
}
