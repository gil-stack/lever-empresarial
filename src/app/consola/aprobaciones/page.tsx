import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { soloTexto, type Direccion } from "@/app/consola/direccion";
import { armarAprobaciones } from "@/components/aprobaciones/armar";
import {
  VistaDeAprobaciones,
  type CargaAprobaciones,
  type HistorialAprobaciones,
  type VistaAprobaciones,
} from "@/components/aprobaciones/vista";
import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { puede, type ContextoDeTenant } from "@/nucleo/contexto";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerFaltanteParaPendientes } from "@/server/flujo/servicio";
import { bandejaDeLaPeticion } from "@/server/inicio/peticion";
import { leerNomina } from "@/server/nomina/servicio";
import { leerPagosProveedores } from "@/server/pagos-proveedores";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Aprobaciones" };

/** Una proyección por petición, como en Pendientes. Nunca rechaza: si falla llega «no_disponible». */
const faltanteDeLaPeticion = cache((ctx: ContextoDeTenant) => leerFaltanteParaPendientes(ctx));

type Apertura = Awaited<ReturnType<typeof abrirRuta>>;

/**
 * Aprobaciones (plat-02): los mismos pendientes que Pendientes y el lateral,
 * con las decisiones que se toman aquí mismo (autorizar o rechazar pagos a
 * proveedores, preparar el lote de nómina) usando las acciones de siempre.
 */
export default async function PaginaAprobaciones({ searchParams }: { searchParams: Direccion }) {
  const apertura = await abrirRuta("/consola/aprobaciones");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const params = await soloTexto(searchParams);
  const vista: VistaAprobaciones = params.vista === "historial" ? "historial" : "pendientes";
  const carga = await cargar(apertura, vista);
  return (
    <Marco actual="/consola/aprobaciones" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina aprobaciones">
        <h1 className="solo-lector">Aprobaciones</h1>
        <VistaDeAprobaciones carga={carga} vista={vista} empresaId={ctx?.empresa?.id ?? null} rechazar={params.rechazar ?? null} />
      </main>
    </Marco>
  );
}

async function cargar(apertura: Apertura, vista: VistaAprobaciones): Promise<CargaAprobaciones> {
  if (apertura.tipo === "libro") return { tipo: "error" };
  if (apertura.tipo === "sin_empresa") return { tipo: "sin_empresa" };
  const ctx = apertura.ctx;
  try {
    const [bandeja, faltante] = await Promise.all([bandejaDeLaPeticion(ctx), faltanteDeLaPeticion(ctx)]);
    const tiene = (id: string) => bandeja.pendientes.some((pendiente) => pendiente.id === id);
    const [pagos, fechaNomina, historial] = await Promise.all([
      vista === "pendientes" && tiene("pagos-por-autorizar") ? pagosPorAutorizar(ctx) : null,
      vista === "pendientes" && tiene("nomina-por-preparar") ? fechaDeNomina(ctx) : null,
      vista === "historial" ? leerHistorial(ctx) : null,
    ]);
    const empresaId = ctx.empresa?.id ?? null;
    return {
      tipo: "lista",
      aprobaciones: armarAprobaciones({ pendientes: bandeja.pendientes, personaId: ctx.persona.id, pagos, fechaNomina }),
      atajos: bandeja.atajos,
      faltante,
      // Quien ve las cifras de Inicio va a la proyección; el resto, a Saldo y alertas (igual que Pendientes).
      destinoFaltante: puede(ctx, "cliente.resumen.ver")
        ? { href: `${enEmpresa(empresaId, "/consola")}#proyeccion-titulo`, texto: "Ver la proyección" }
        : { href: enEmpresa(empresaId, "/consola/flujo"), texto: "Revisar saldo y alertas" },
      historial,
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { tipo: "error" };
    throw error;
  }
}

/**
 * Los pagos «por autorizar» que esta persona puede decidir. Si la lectura
 * falla, el pendiente se queda como enlace a Proveedores: no se pierde.
 */
async function pagosPorAutorizar(ctx: ContextoDeTenant) {
  if (!puede(ctx, "cliente.pago.liberar") || !puede(ctx, "cliente.proveedores.ver")) return null;
  return opcional("pagos", ctx, async () => {
    const lectura = await leerPagosProveedores(ctx, { estado: "por_autorizar" });
    return { pagos: lectura.pagos, hayMas: lectura.hayMas };
  });
}

/** La fecha que prepara el botón de Nómina: la calcula el servidor (la más antigua vencida y sin lote). */
async function fechaDeNomina(ctx: ContextoDeTenant) {
  if (!puede(ctx, "cliente.pago.solicitar") || !puede(ctx, "cliente.maestro.ver")) return null;
  return opcional("nomina", ctx, async () => (await leerNomina(ctx)).totales.primeraVencida);
}

async function leerHistorial(ctx: ContextoDeTenant): Promise<HistorialAprobaciones | null> {
  const [pagos, lotes] = await Promise.all([
    puede(ctx, "cliente.proveedores.ver")
      ? opcional("historial_pagos", ctx, async () => (await leerPagosProveedores(ctx, { estado: "por_autorizar" })).actividad)
      : null,
    puede(ctx, "cliente.maestro.ver") ? opcional("historial_nomina", ctx, async () => (await leerNomina(ctx)).lotes) : null,
  ]);
  const fallo = (puede(ctx, "cliente.proveedores.ver") && pagos === null) || (puede(ctx, "cliente.maestro.ver") && lotes === null);
  return fallo ? null : { pagos, lotes };
}

/**
 * Una lectura de apoyo que no tumba la página: el fallo queda registrado con
 * su código (nunca el mensaje crudo) y la página sigue con lo que sí leyó.
 */
async function opcional<T>(lectura: string, ctx: ContextoDeTenant, leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (error) {
    if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
    console.error(
      JSON.stringify({
        evento: "aprobaciones.lectura_no_disponible",
        lectura,
        codigo: error instanceof ErrorDeDominio ? error.codigo : "base_no_disponible",
        peticionId: ctx.peticionId,
      }),
    );
    return null;
  }
}
