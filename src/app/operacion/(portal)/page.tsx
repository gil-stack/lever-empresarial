import type { Metadata } from "next";
import Link from "next/link";

import { PaginaOperacion } from "@/components/operacion/pagina";
import { fechaHora } from "@/components/operacion/formato";
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
  return (
    <PaginaOperacion titulo={`Hola, ${ctx.persona.nombre}.`} descripcion="Origina clientes, coordina decisiones y deja un rastro verificable. Nada en esta superficie mueve dinero.">
      <section className="operacion-rejilla operacion-rejilla-tres" aria-label="Pendientes">
        <article className="operacion-tarjeta"><h2>Clientes</h2><strong className="operacion-metrica">{clientes.length}</strong><p className="pista">{clientes.filter((c) => c.estado === "activa").length} activos para el portal</p><Link className="enlace-texto" href="/operacion/clientes">Ver clientes</Link></article>
        <article className="operacion-tarjeta"><h2>Por decidir</h2><strong className="operacion-metrica">{solicitudes.length + comisionesPendientes.length}</strong><p className="pista">{solicitudes.length} activaciones · {comisionesPendientes.length} comisiones</p><Link className="enlace-texto" href="/operacion/aprobaciones">Revisar decisiones</Link></article>
        <article className="operacion-tarjeta"><h2>Alertas abiertas</h2><strong className="operacion-metrica">{abiertas.length}</strong><p className="pista">Con responsable y cierre por motivo</p><Link className="enlace-texto" href="/operacion/alertas">Atender alertas</Link></article>
      </section>
      <section className="operacion-rejilla" style={{ marginTop: 20 }}>
        <article className="operacion-tarjeta">
          <h2>Próximas decisiones</h2>
          {solicitudes.length === 0 && comisionesPendientes.length === 0 ? <p className="vacio">No hay decisiones pendientes.</p> : (
            <ul className="operacion-lista">
              {solicitudes.slice(0, 4).map((solicitud) => <li key={solicitud.id}><h3>{solicitud.razonSocial}</h3><p className="operacion-meta">Activación · solicitó {solicitud.solicitante} · {fechaHora(solicitud.solicitadaEn)}</p></li>)}
              {comisionesPendientes.slice(0, 4).map((comision) => <li key={comision.id}><h3>{comision.razonSocial} · {comision.tipo}</h3><p className="operacion-meta">Comisión · propuso {comision.solicitante}</p></li>)}
            </ul>
          )}
        </article>
        <article className="operacion-tarjeta">
          <h2>Regla de esta fase</h2>
          <p className="lede">“Activa” significa que la empresa puede usar el portal. No implica KYB, PLD, riesgo, crédito, SPEI, cargos ni conciliación.</p>
          <p className="nota-regla">Toda activación y toda versión de comisión exige dos personas distintas. Las decisiones y sus efectos se confirman en la misma transacción.</p>
        </article>
      </section>
    </PaginaOperacion>
  );
}
