import type { Metadata } from "next";

import { Maestro, MaestroCerrado } from "@/components/personas/maestro";
import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { hoyEnMexico } from "@/dominio/personas";
import { puede, type ContextoDeTenant } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerMaestro } from "@/server/personas";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Personas",
};

export default async function PaginaPersonas() {
  const apertura = await abrirRuta("/consola/personas");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const hoy = hoyEnMexico(new Date());
  const cerrado = await cerrar(apertura.tipo === "abierta" ? apertura.ctx : null, apertura.tipo);

  return (
    <Marco actual="/consola/personas" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="consola">
        {cerrado.tipo === "abierto" && ctx ? (
          <Maestro lectura={cerrado.lectura} hoy={hoy} roles={ctx.roles} edita={puede(ctx, "cliente.maestro.editar")} />
        ) : cerrado.tipo === "cerrado" ? (
          <MaestroCerrado aviso={cerrado.aviso} />
        ) : null}
      </main>
    </Marco>
  );
}

async function cerrar(ctx: ContextoDeTenant | null, apertura: string) {
  if (apertura === "libro") return { tipo: "cerrado" as const, aviso: "libro" as const };
  if (apertura === "sin_empresa") return { tipo: "cerrado" as const, aviso: "sin_empresa" as const };
  if (!ctx) return { tipo: "cerrado" as const, aviso: "no_abre" as const };
  try {
    const lectura = await leerMaestro(ctx);
    return { tipo: "abierto" as const, lectura };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      if (error.codigo === "maestro_no_disponible") return { tipo: "cerrado" as const, aviso: "no_abre" as const };
      if (error.codigo === "sin_empresa") return { tipo: "cerrado" as const, aviso: "sin_empresa" as const };
      if (error.codigo === "sesion_ausente") return { tipo: "cerrado" as const, aviso: "entrar" as const };
      return { tipo: "cerrado" as const, aviso: "libro" as const };
    }
    if (errorConSecreto(error)) return { tipo: "cerrado" as const, aviso: "libro" as const };
    throw error;
  }
}
