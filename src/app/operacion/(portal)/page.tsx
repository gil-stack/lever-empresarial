import type { Metadata } from "next";
import Link from "next/link";

import { DecisionesOperacion } from "@/components/operacion/decisiones";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Metrica, Metricas, Monto, NotaRegla } from "@/components/sistema";
import {
  exigirContextoOperacion,
  listarAlertas,
  listarClientes,
  listarComisiones,
  listarSolicitudesActivacion,
  listarSuspensionesPendientes,
  puedeEnOperacion,
} from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Resumen de operación" };

export default async function ResumenOperacion() {
  const ctx = await exigirContextoOperacion();
  const [clientes, solicitudes, alertas, comisiones, suspensiones] = await Promise.all([
    listarClientes(ctx),
    listarSolicitudesActivacion(ctx),
    listarAlertas(ctx),
    listarComisiones(ctx),
    listarSuspensionesPendientes(ctx),
  ]);
  const decide = {
    activaciones: puedeEnOperacion(ctx, "plataforma.activacion.aprobar"),
    comisiones: puedeEnOperacion(ctx, "plataforma.empresa.alta"),
    suspensiones: puedeEnOperacion(ctx, "plataforma.suspension.aprobar"),
  };
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
        <Metrica
          rotulo="Por decidir"
          nota={`${solicitudes.length} ${solicitudes.length === 1 ? "activación" : "activaciones"} · ${comisionesPendientes.length} ${comisionesPendientes.length === 1 ? "comisión" : "comisiones"} · ${suspensiones.length} ${suspensiones.length === 1 ? "suspensión" : "suspensiones"}`}
        >
          <Monto>{solicitudes.length + comisionesPendientes.length + suspensiones.length}</Monto>
          <Link className="enlace-texto" href="/operacion/aprobaciones">Ir a Aprobaciones</Link>
        </Metrica>
        <Metrica rotulo="Alertas abiertas" nota="Cada una con responsable">
          <Monto>{abiertas.length}</Monto>
          <Link className="enlace-texto" href="/operacion/alertas">Atender alertas</Link>
        </Metrica>
      </Metricas>
      <DecisionesOperacion
        solicitudes={solicitudes}
        comisiones={comisionesPendientes}
        suspensiones={suspensiones}
        personaId={ctx.persona.id}
        decide={decide}
      />
      <NotaRegla>
        «Activa» quiere decir que la empresa ya puede usar el portal. Para activarla, la base exige un expediente aprobado por
        Cumplimiento en su versión vigente, un grado de riesgo vigente y ninguna coincidencia con la Lista de Personas Bloqueadas
        sin resolver. Cada decisión la toma una persona distinta a quien la pidió.
      </NotaRegla>
    </PaginaOperacion>
  );
}
