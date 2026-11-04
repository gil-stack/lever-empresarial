import type { Metadata } from "next";
import Link from "next/link";

import { decidirActivacionAccion, decidirComisionAccion } from "@/app/operacion/acciones";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { textoComision } from "@/dominio/operacion";
import { exigirContextoOperacion, listarComisiones, listarSolicitudesActivacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Aprobaciones · Operación" };

export default async function AprobacionesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [solicitudes, versiones, params] = await Promise.all([listarSolicitudesActivacion(ctx), listarComisiones(ctx), searchParams]);
  const comisiones = versiones.filter((version) => version.estado === "pendiente");
  return (
    <PaginaOperacion titulo="Aprobaciones" descripcion="Quien originó una solicitud no puede decidirla. Aprobar exige un segundo factor verificado en los últimos 30 minutos." aviso={params.aviso}>
      <div className="operacion-rejilla">
        <section className="operacion-tarjeta">
          <h2>Activaciones para el portal</h2>
          <p className="pista">{solicitudes.length} pendientes. No son revisiones KYB ni PLD.</p>
          {solicitudes.length === 0 ? <p className="vacio">No hay activaciones pendientes.</p> : <ul className="operacion-lista">{solicitudes.map((solicitud) => {
            const propia = solicitud.solicitadaPor === ctx.persona.id;
            return <li key={solicitud.id}>
              <div className="operacion-fila"><div className="operacion-fila-cuerpo"><h3><Link href={`/operacion/clientes/${solicitud.companyId}`}>{solicitud.razonSocial}</Link></h3><p className="operacion-meta">{solicitud.rfc} · solicitó {solicitud.solicitante} · {fechaHora(solicitud.solicitadaEn)}</p></div></div>
              {propia ? <p className="nota-regla">La solicitaste tú. Debe decidir otra persona.</p> : <Decision id={solicitud.id} accion={decidirActivacionAccion} etiqueta="activación" />}
            </li>;
          })}</ul>}
        </section>
        <section className="operacion-tarjeta">
          <h2>Versiones de comisión</h2>
          <p className="pista">{comisiones.length} pendientes. Autorizar configura, no cobra.</p>
          {comisiones.length === 0 ? <p className="vacio">No hay versiones pendientes.</p> : <ul className="operacion-lista">{comisiones.map((comision) => {
            const propia = comision.solicitadaPor === ctx.persona.id;
            return <li key={comision.id}>
              <div className="operacion-fila"><div className="operacion-fila-cuerpo"><h3>{comision.razonSocial} · {comision.tipo}</h3><p className="operacion-detalle">{textoComision(comision.tipo, comision.valor)}</p><p className="operacion-meta">Desde {fechaDia(comision.vigenteDesde)} · propuso {comision.solicitante}</p></div></div>
              {propia ? <p className="nota-regla">La propusiste tú. Debe decidir otra persona.</p> : <Decision id={comision.id} accion={decidirComisionAccion} etiqueta="versión" />}
            </li>;
          })}</ul>}
        </section>
      </div>
    </PaginaOperacion>
  );
}

function Decision({ id, accion, etiqueta }: { id: string; accion: (formData: FormData) => Promise<void>; etiqueta: string }) {
  return (
    <div className="operacion-acciones" style={{ marginTop: 16 }}>
      <form action={accion}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="aprobar" /><button className="boton" type="submit">Aprobar {etiqueta}</button></form>
      <form action={accion}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="rechazar" /><div className="campo"><label htmlFor={`motivo-${id}`}>Motivo de rechazo</label><input id={`motivo-${id}`} name="motivo" maxLength={500} required /></div><button className="boton-texto" type="submit">Rechazar</button></form>
    </div>
  );
}
