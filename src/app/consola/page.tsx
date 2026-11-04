import type { Metadata } from "next";

import { ConsolaVacia } from "@/components/consola/consola-vacia";
import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { relatoOperabilidad } from "@/dominio/personas";
import type { VistaCajones } from "@/dominio/politica";
import { puede, type ContextoDeTenant } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { resumenParaConsola } from "@/server/personas";
import { leerCajones } from "@/server/politica/servicio";
import { leerSuscripcionDeLaEmpresa, leerTarifa } from "@/server/precio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Consola",
};

type CargaCajones =
  | { tipo: "listos"; vista: VistaCajones }
  | { tipo: "aviso"; mensaje: string };

export default async function PaginaConsola() {
  const apertura = await abrirRuta("/consola");
  const ctx = apertura.tipo === "abierta" ? apertura.ctx : null;
  const empresa = ctx?.empresa ? { rfc: ctx.empresa.rfc, razonSocial: ctx.empresa.razonSocial } : null;
  const [tarifa, suscripcion, cajones, personas] = await Promise.all([
    leerTarifa(),
    leerSuscripcionDeLaEmpresa(ctx),
    ctx ? cargarCajones(ctx) : Promise.resolve(null),
    ctx && puede(ctx, "cliente.maestro.ver") ? resumenDePersonas(ctx) : Promise.resolve(null),
  ]);

  return (
    <Marco actual="/consola" vista={vistaDeMarco(apertura.tipo === "libro" ? null : apertura.ctx)}>
      <main id="contenido">
        <ConsolaVacia
          empresa={empresa}
          libroDisponible={apertura.tipo !== "libro"}
          conSesion={Boolean(ctx)}
          nombre={ctx?.persona.nombre ?? null}
          personas={personas}
          cajones={empresa ? cajones : null}
          tarifa={tarifa}
          suscripcion={suscripcion}
        />
      </main>
    </Marco>
  );
}

async function resumenDePersonas(
  ctx: ContextoDeTenant,
): Promise<{ titulo: string; detalle: string } | { fallo: true } | null> {
  try {
    const cuentas = await resumenParaConsola(ctx);
    if (!cuentas) return { fallo: true };
    const relato = relatoOperabilidad(cuentas.nombres);
    return { titulo: relato.titulo, detalle: relato.detalle };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { fallo: true };
    throw error;
  }
}

async function cargarCajones(ctx: ContextoDeTenant): Promise<CargaCajones> {
  try {
    const vista = await leerCajones(ctx);
    if (!vista) return { tipo: "aviso", mensaje: "No se pudieron leer los cajones." };
    return { tipo: "listos", vista };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) {
      return { tipo: "aviso", mensaje: mensajeCajones(error instanceof ErrorDeDominio ? error.codigo : "") };
    }
    throw error;
  }
}

function mensajeCajones(codigo: string): string {
  if (codigo === "cajones_incompletos") return "Los cajones de esta cuenta no están completos.";
  if (codigo === "politica_ausente") return "Esta cuenta todavía no tiene política en el libro.";
  return "No se pudieron leer los cajones.";
}
