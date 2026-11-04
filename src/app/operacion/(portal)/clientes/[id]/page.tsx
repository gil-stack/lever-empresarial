import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { invitarAdministradorAccion, solicitarActivacionAccion } from "@/app/operacion/acciones";
import { etiquetaEstado, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { exigirContextoOperacion, leerCliente, listarComisiones } from "@/server/operacion";
import { textoComision } from "@/dominio/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Ficha de cliente · Operación" };

export default async function FichaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [{ id }, aviso] = await Promise.all([params, searchParams]);
  const cliente = await leerCliente(ctx, id);
  if (!cliente) notFound();
  const comisiones = await listarComisiones(ctx, id);
  return (
    <PaginaOperacion titulo={cliente.razonSocial} descripcion={`${cliente.rfc} · ${etiquetaEstado(cliente.estado)}. La activación se limita al uso del portal.`} aviso={aviso.aviso}>
      <div className="operacion-rejilla">
        <div className="operacion-columna">
          <section className="operacion-tarjeta">
            <div className="operacion-fila"><h2>Datos y activación</h2><span className={`insignia ${cliente.estado === "activa" ? "insignia-sello" : ""}`}>{etiquetaEstado(cliente.estado)}</span></div>
            <dl className="renglones"><div><dt>Código postal</dt><dd>{cliente.codigoPostal}</dd></div><div><dt>Régimen fiscal</dt><dd>{cliente.regimen}</dd></div><div><dt>Uso CFDI</dt><dd>{cliente.usoCfdi}</dd></div><div><dt>Administrador</dt><dd>{cliente.administrador ?? "Todavía no invitado"}</dd></div></dl>
            {cliente.estado === "prospecto" ? <form action={solicitarActivacionAccion}><input type="hidden" name="companyId" value={cliente.id} /><div className="acciones"><button className="boton" type="submit">Solicitar activación</button></div><p className="pista">Pasará a “en alta”. Otra persona deberá aprobarla.</p></form> : null}
            {cliente.estado === "en_alta" ? <p className="nota-regla">Hay una solicitud pendiente. La decisión se toma en <Link href="/operacion/aprobaciones">Aprobaciones</Link>.</p> : null}
          </section>
          <section className="operacion-tarjeta">
            <h2>Primer administrador</h2>
            <p className="pista">Usa el mecanismo de invitaciones existente. Reenviar revoca el token anterior. En desarrollo no se envía correo.</p>
            {cliente.estado === "activa" && cliente.administradorEstado !== "activa" ? (
              <form action={invitarAdministradorAccion} className="operacion-forma">
                <input type="hidden" name="companyId" value={cliente.id} />
                <div className="campo"><label htmlFor="nombre">Nombre</label><input id="nombre" name="nombre" maxLength={200} defaultValue={cliente.administrador ?? ""} required /></div>
                <div className="campo"><label htmlFor="correo">Correo</label><input id="correo" name="correo" type="email" maxLength={254} defaultValue={cliente.administradorCorreo ?? ""} required /></div>
                <div className="acciones"><button className="boton" type="submit">{cliente.administrador ? "Reenviar invitación" : "Emitir invitación"}</button></div>
              </form>
            ) : <p className="vacio">{cliente.administradorEstado === "activa" ? "El primer administrador ya aceptó su invitación." : "Disponible cuando la empresa esté activa para el portal."}</p>}
            {cliente.entregas.length > 0 ? <ul className="operacion-lista">{cliente.entregas.map((entrega) => <li key={entrega.id}><p>{entrega.estado === "omitida_desarrollo" ? "Correo omitido en desarrollo" : entrega.estado === "enviada" ? "Correo enviado" : "Entrega fallida"}</p><p className="operacion-meta">{fechaHora(entrega.registradaEn)}{entrega.detalle ? ` · ${entrega.detalle}` : ""}</p></li>)}</ul> : null}
          </section>
          <section className="operacion-tarjeta">
            <h2>Historial de estados</h2>
            <ul className="operacion-lista">{cliente.historial.map((evento) => <li key={evento.id}><p>{evento.estadoAnterior ? `${etiquetaEstado(evento.estadoAnterior)} → ` : ""}{etiquetaEstado(evento.estadoNuevo)}</p><p className="operacion-meta">{evento.actor} · {fechaHora(evento.ocurridoEn)}</p></li>)}</ul>
          </section>
        </div>
        <section className="operacion-tarjeta">
          <h2>Comisiones configuradas</h2>
          <p className="pista">Solo reglas comerciales. Nunca cargos ni devengos.</p>
          {comisiones.length === 0 ? <p className="vacio">Sin versiones de comisión.</p> : <ul className="operacion-lista">{comisiones.map((comision) => <li key={comision.id}><div className="operacion-fila"><h3>{comision.tipo}</h3><span className="insignia">{etiquetaEstado(comision.estado)}</span></div><p className="operacion-detalle">{textoComision(comision.tipo, comision.valor)}</p><p className="operacion-meta">Desde {comision.vigenteDesde}{comision.vigenteHasta ? ` hasta ${comision.vigenteHasta}` : ""}</p></li>)}</ul>}
          <Link className="enlace-texto" href="/operacion/comisiones">Configurar comisiones</Link>
        </section>
      </div>
    </PaginaOperacion>
  );
}
