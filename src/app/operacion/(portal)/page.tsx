import type { Metadata } from "next";
import Link from "next/link";

import { DecisionesOperacion } from "@/components/operacion/decisiones";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Metrica, Metricas, Monto, NotaRegla } from "@/components/sistema";
import { exigirContextoOperacion, listarAlertas, listarClientes, listarComisiones, listarSolicitudesActivacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Resumen de operación" };

export default async function ResumenOperacion() {
  const ctx = await exigirContextoOperacion();
  const [clientes, solicitudes, alertas, comisiones] = await Promise.all([
    listarClientes(ctx),
    listarSolicitudesActivacion(ctx),
    listarAlertas(ctx),
    listarComisiones(ctx),
  ]);
  const abiertas = alertas.filter((alerta) => alerta.estado === "abierta");
  const comisionesPendientes = comisiones.filter((comision) => comision.estado === "pendiente");
  const activos = clientes.filter((cliente) => cliente.estado === "activa").length;
  return (
    <PaginaOperacion titulo="Resumen">
      <p className="saludo">Hola, {ctx.persona.nombre} · Operación SOFIPO</p>
      <Metricas etiqueta="Operación">
        <Metrica rotulo="Clientes" nota={`${activos} ${activos === 1 ? "activo" : "activos"} para el portal`}>
          <Monto>{clientes.length}</Monto>
          <Link className="enlace-texto" href="/operacion/clientes">Ver clientes</Link>
        </Metrica>
        <Metrica rotulo="Por decidir" nota={`${solicitudes.length} ${solicitudes.length === 1 ? "activación" : "activaciones"} · ${comisionesPendientes.length} ${comisionesPendientes.length === 1 ? "comisión" : "comisiones"}`}>
          <Monto>{solicitudes.length + comisionesPendientes.length}</Monto>
          <Link className="enlace-texto" href="/operacion/aprobaciones">Ir a Aprobaciones</Link>
        </Metrica>
        <Metrica rotulo="Alertas abiertas" nota="Cada una con responsable">
          <Monto>{abiertas.length}</Monto>
          <Link className="enlace-texto" href="/operacion/alertas">Atender alertas</Link>
        </Metrica>
      </Metricas>
      <DecisionesOperacion solicitudes={solicitudes} comisiones={comisionesPendientes} personaId={ctx.persona.id} />
      <NotaRegla>
        «Activa» quiere decir que la empresa ya puede usar el portal; no sustituye la revisión KYB. Cada activación y
        cada comisión las decide una persona distinta a quien las pidió.
      </NotaRegla>
    </PaginaOperacion>
  );
}
