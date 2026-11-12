import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { solicitarActivacionAccion } from "@/app/operacion/acciones";
import { REGIMENES, USOS_CFDI, conNombre, etiquetaEstado, fechaDia, fechaHora, motivoDeEntrega } from "@/components/operacion/formato";
import { FormularioInvitacion } from "@/components/operacion/formulario-invitacion";
import { FormularioSuspension } from "@/components/operacion/formulario-suspension";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SeccionTarjetasEfevoo } from "@/components/operacion/seccion-efevoo";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Rejilla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import { leerSeccionEfevoo } from "@/server/efevoo/operacion";
import { exigirContextoOperacion, leerCliente, listarComisiones, listarSuspensionesDeEmpresa, puedeEnOperacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Ficha de cliente · Operación" };

const ENTREGAS: Record<string, string> = {
  omitida_desarrollo: "Correo omitido en este entorno",
  enviada: "Correo enviado",
};

export default async function FichaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const [{ id }, { aviso }] = await Promise.all([params, soloTexto(searchParams)]);
  const cliente = await leerCliente(ctx, id);
  if (!cliente) notFound();
  const veExpediente = puedeEnOperacion(ctx, "plataforma.expediente.ver");
  // Que la suspensión vino de la lista lo ven Cumplimiento y Auditoría (55ª fr. I).
  const veLista = puedeEnOperacion(ctx, "plataforma.cumplimiento.bandeja");
  // Tarjetas (Efevoo): solo Administración de la plataforma.
  const veEfevoo = puedeEnOperacion(ctx, "plataforma.empresa.alta");
  const [comisiones, suspensiones, efevoo] = await Promise.all([
    listarComisiones(ctx, id),
    veExpediente ? listarSuspensionesDeEmpresa(ctx, id) : Promise.resolve([]),
    veEfevoo ? leerSeccionEfevoo(ctx, cliente.id) : Promise.resolve(null),
  ]);
  const pideActivacion = puedeEnOperacion(ctx, "plataforma.activacion.solicitar");
  const invita = puedeEnOperacion(ctx, "plataforma.invitacion.emitir");
  const pideSuspension = puedeEnOperacion(ctx, "plataforma.suspension.solicitar");
  const suspensionPendiente = suspensiones.find((suspension) => suspension.estado === "pendiente");
  const notaPendiente = suspensionPendiente ? (
    <NotaRegla>
      Hay una solicitud de {suspensionPendiente.tipo === "suspension" ? "suspensión" : "reactivación"} pendiente. Se decide en{" "}
      <Link href="/operacion/aprobaciones">Aprobaciones</Link>.
    </NotaRegla>
  ) : null;
  return (
    <PaginaOperacion
      titulo={cliente.razonSocial}
      aviso={aviso}
      accion={<Link className="boton-texto" href="/operacion/clientes">← Clientes</Link>}
    >
      <div className="operacion-ficha-cabeza">
        <EtiquetaMono nombre="RFC">{cliente.rfc}</EtiquetaMono>
        <Insignia tono={cliente.estado === "activa" ? "sello" : "neutro"}>{etiquetaEstado(cliente.estado)}</Insignia>
      </div>
      <Rejilla
        principal={
          <>
            <Hoja id="datos-titulo" titulo="Datos y activación">
              <Renglones>
                <Renglon etiqueta="Código postal">{cliente.codigoPostal}</Renglon>
                <Renglon etiqueta="Régimen fiscal">{conNombre(REGIMENES, cliente.regimen)}</Renglon>
                <Renglon etiqueta="Uso CFDI">{conNombre(USOS_CFDI, cliente.usoCfdi)}</Renglon>
                <Renglon etiqueta="Administrador">{cliente.administrador ?? "Todavía no invitado"}</Renglon>
              </Renglones>
              {cliente.estado === "prospecto" && pideActivacion ? (
                <form action={solicitarActivacionAccion}>
                  <input type="hidden" name="companyId" value={cliente.id} />
                  <div className="acciones">
                    <BotonEnviar>Solicitar activación</BotonEnviar>
                    <p>Pasa a «En alta» y la decide otra persona. La base solo deja activar con el expediente aprobado y el riesgo vigente.</p>
                  </div>
                </form>
              ) : null}
              {cliente.estado === "en_alta" ? (
                <NotaRegla>
                  La activación está pendiente. Se decide en <Link href="/operacion/aprobaciones">Aprobaciones</Link>.
                </NotaRegla>
              ) : null}
            </Hoja>
            {veExpediente ? (
              <Hoja id="expediente-titulo" titulo="Expediente y riesgo">
                <p>Datos de la empresa, representantes, estructura accionaria, propietarios reales, documentos, dictamen y grado de riesgo.</p>
                <p className="operacion-enlace">
                  <Link className="enlace-texto" href={`/operacion/clientes/${cliente.id}/expediente`}>Abrir expediente</Link>
                </p>
                <p className="pista">Abrirlo queda en la bitácora con tu nombre y la hora.</p>
              </Hoja>
            ) : null}
            <Hoja id="suspension-titulo" titulo="Suspensión">
              {cliente.estado === "suspendida" ? (
                <p>La empresa está suspendida: no mueve dinero, no prepara nómina, no recibe invitaciones y su gente solo puede consultar.</p>
              ) : (
                <p>Suspender detiene en la base todo lo que mueve dinero o escribe en la consola de la empresa.</p>
              )}
              {pideSuspension && (cliente.estado === "activa" || cliente.estado === "suspendida") ? (
                <FormularioSuspension
                  companyId={cliente.id}
                  formId={randomUUID()}
                  tipo={cliente.estado === "activa" ? "suspension" : "reactivacion"}
                  paraCumplimiento={veLista}
                  pendiente={notaPendiente}
                />
              ) : (
                notaPendiente
              )}
              {suspensiones.length > 0 ? (
                <ul className="operacion-lista">
                  {suspensiones.map((suspension) => (
                    <li key={suspension.id}>
                      <div className="operacion-fila">
                        <p>
                          {suspension.tipo === "suspension" ? "Suspensión" : "Reactivación"}
                          {suspension.origen === "lpb" ? (veLista ? " por la Lista de Personas Bloqueadas" : " en revisión de Cumplimiento") : ""}
                        </p>
                        <Insignia tono={suspension.estado === "aprobada" ? "aviso" : "neutro"}>{etiquetaEstado(suspension.estado)}</Insignia>
                      </div>
                      <p className="operacion-meta">
                        <span>{suspension.solicitadaPor ?? "Sistema"} · {fechaHora(suspension.solicitadaEn)}</span>
                        {suspension.decididaPor ? <span>Decidió {suspension.decididaPor}</span> : null}
                      </p>
                      {suspension.origen === "lpb" && !veLista ? null : <p className="operacion-detalle">{suspension.motivo}</p>}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Hoja>
            {efevoo ? <SeccionTarjetasEfevoo companyId={cliente.id} seccion={efevoo} /> : null}
            <Hoja id="historial-titulo" titulo="Historial de estados">
              <ul className="operacion-lista">
                {cliente.historial.map((evento) => (
                  <li key={evento.id}>
                    <p>
                      {evento.estadoAnterior ? `${etiquetaEstado(evento.estadoAnterior)} → ` : ""}
                      {etiquetaEstado(evento.estadoNuevo)}
                    </p>
                    <p className="operacion-meta">
                      {evento.actor} · {fechaHora(evento.ocurridoEn)}
                    </p>
                  </li>
                ))}
              </ul>
            </Hoja>
          </>
        }
        lateral={
          <>
            <Hoja id="administrador-titulo" titulo="Primer administrador">
              {cliente.estado === "activa" && cliente.administradorEstado !== "activa" && invita ? (
                <FormularioInvitacion
                  companyId={cliente.id}
                  vista={cliente.ultimaInvitacionId ?? ""}
                  nombre={cliente.administrador}
                  correo={cliente.administradorCorreo}
                />
              ) : (
                <Vacio
                  titulo={
                    cliente.administradorEstado === "activa"
                      ? "Ya entró"
                      : cliente.estado === "activa"
                        ? "La envía Administración"
                        : cliente.estado === "suspendida"
                          ? "Empresa suspendida"
                          : "Primero, la activación"
                  }
                >
                  {cliente.administradorEstado === "activa"
                    ? "El primer administrador aceptó su invitación."
                    : cliente.estado === "activa"
                      ? "Las invitaciones las emite Administración de la plataforma."
                      : cliente.estado === "suspendida"
                        ? "Mientras esté suspendida no salen invitaciones."
                        : "La invitación se envía cuando la empresa esté activa para el portal."}
                </Vacio>
              )}
              {cliente.entregas.length > 0 ? (
                <ul className="operacion-lista">
                  {cliente.entregas.map((entrega) => (
                    <li key={entrega.id}>
                      <p>{ENTREGAS[entrega.estado] ?? "El correo no salió"}</p>
                      <p className="operacion-meta">
                        {fechaHora(entrega.registradaEn)}
                        {motivoDeEntrega(entrega.detalle) ? ` · ${motivoDeEntrega(entrega.detalle)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Hoja>
            <Hoja id="comisiones-titulo" titulo="Comisiones">
              {comisiones.length === 0 ? (
                <Vacio titulo="Sin comisiones">Se proponen en Comisiones y las autoriza otra persona.</Vacio>
              ) : (
                <ul className="operacion-lista">
                  {comisiones.map((comision) => (
                    <li key={comision.id}>
                      <div className="operacion-fila">
                        <p>{textoComision(comision.tipo, comision.valor)}</p>
                        <Insignia tono={comision.estado === "vigente" ? "sello" : "neutro"}>{etiquetaEstado(comision.estado)}</Insignia>
                      </div>
                      <p className="operacion-meta">
                        Desde {fechaDia(comision.vigenteDesde)}
                        {comision.vigenteHasta ? ` hasta ${fechaDia(comision.vigenteHasta)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="operacion-enlace">
                <Link className="enlace-texto" href="/operacion/comisiones">Ir a Comisiones</Link>
              </p>
            </Hoja>
          </>
        }
      />
    </PaginaOperacion>
  );
}
