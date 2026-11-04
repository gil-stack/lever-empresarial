import type { Metadata } from "next";
import Link from "next/link";

import { asignarAlertaAccion, cerrarAlertaAccion, crearAlertaAccion } from "@/app/operacion/acciones";
import { etiquetaEstado, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { exigirContextoOperacion, listarAlertas, listarClientes, listarPersonal } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alertas · Operación" };

export default async function AlertasOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [alertas, clientes, personal, params] = await Promise.all([listarAlertas(ctx), listarClientes(ctx), listarPersonal(ctx), searchParams]);
  return (
    <PaginaOperacion titulo="Alertas operativas" descripcion="Cada alerta tiene responsable. El cierre exige un motivo y no se puede reescribir." aviso={params.aviso}>
      <div className="operacion-rejilla">
        <section className="operacion-tarjeta">
          <h2>Nueva alerta</h2>
          <p className="pista">Para seguimiento operativo, no para cumplimiento o riesgo.</p>
          <form action={crearAlertaAccion} className="operacion-forma">
            <div className="campo"><label htmlFor="companyId">Empresa</label><select id="companyId" name="companyId" required>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.razonSocial}</option>)}</select></div>
            <div className="campo"><label htmlFor="responsableId">Responsable</label><select id="responsableId" name="responsableId" defaultValue={ctx.persona.id} required>{personal.map((persona) => <option key={persona.id} value={persona.id}>{persona.nombre}</option>)}</select></div>
            <div className="campo operacion-ancho"><label htmlFor="titulo">Título</label><input id="titulo" name="titulo" maxLength={160} required /></div>
            <div className="campo operacion-ancho"><label htmlFor="detalle">Detalle</label><textarea id="detalle" name="detalle" maxLength={500} required /></div>
            <div className="acciones"><button className="boton" type="submit" disabled={clientes.length === 0}>Crear alerta</button></div>
          </form>
        </section>
        <section className="operacion-tarjeta">
          <h2>Seguimiento</h2>
          <p className="pista">{alertas.filter((alerta) => alerta.estado === "abierta").length} abiertas de {alertas.length} registradas.</p>
          {alertas.length === 0 ? <p className="vacio">No hay alertas.</p> : <ul className="operacion-lista">{alertas.map((alerta) => <li key={alerta.id}>
            <div className="operacion-fila"><div className="operacion-fila-cuerpo"><h3><Link href={`/operacion/clientes/${alerta.companyId}`}>{alerta.titulo}</Link></h3><p className="operacion-meta">{alerta.razonSocial} · {alerta.categoria} · responsable: {alerta.responsable}</p><p className="operacion-detalle">{alerta.detalle}</p></div><span className={`insignia ${alerta.estado === "abierta" ? "insignia-aviso" : ""}`}>{etiquetaEstado(alerta.estado)}</span></div>
            {alerta.estado === "abierta" ? <div className="operacion-acciones" style={{ marginTop: 14 }}>
              <form action={asignarAlertaAccion}><input type="hidden" name="id" value={alerta.id} /><div className="campo"><label htmlFor={`responsable-${alerta.id}`}>Reasignar</label><select id={`responsable-${alerta.id}`} name="responsableId" defaultValue={alerta.responsableId}>{personal.map((persona) => <option key={persona.id} value={persona.id}>{persona.nombre}</option>)}</select></div><button className="boton-texto" type="submit">Guardar responsable</button></form>
              <form action={cerrarAlertaAccion}><input type="hidden" name="id" value={alerta.id} /><div className="campo"><label htmlFor={`motivo-${alerta.id}`}>Motivo de cierre</label><input id={`motivo-${alerta.id}`} name="motivo" maxLength={500} required /></div><button className="boton-texto" type="submit">Cerrar alerta</button></form>
            </div> : <p className="operacion-meta">Cerrada por {alerta.cerradaPor} · {alerta.cerradaEn ? fechaHora(alerta.cerradaEn) : ""}<br />Motivo: {alerta.motivoCierre}</p>}
          </li>)}</ul>}
        </section>
      </div>
    </PaginaOperacion>
  );
}
