import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { invitarAdministradorAccion, solicitarActivacionAccion } from "@/app/operacion/acciones";
import { solicitarSuspensionAccion } from "@/app/operacion/acciones-alta";
import { errorDelCampo } from "@/components/operacion/aviso";
import { REGIMENES, USOS_CFDI, conNombre, etiquetaEstado, fechaDia, fechaHora, motivoDeEntrega } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Rejilla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import { exigirContextoOperacion, leerCliente, listarComisiones, listarSuspensionesDeEmpresa, puedeEnOperacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Ficha de cliente · Operación" };

const ENTREGAS: Record<string, string> = {
  omitida_desarrollo: "Correo omitido en este entorno",
  enviada: "Correo enviado",
};

export default async function FichaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [{ id }, { aviso }] = await Promise.all([params, searchParams]);
  const cliente = await leerCliente(ctx, id);
  if (!cliente) notFound();
  const veExpediente = puedeEnOperacion(ctx, "plataforma.expediente.ver");
  // Que la suspensión vino de la lista lo ven Cumplimiento y Auditoría (55ª fr. I).
  const veLista = puedeEnOperacion(ctx, "plataforma.cumplimiento.bandeja");
  const [comisiones, suspensiones] = await Promise.all([
    listarComisiones(ctx, id),
    veExpediente ? listarSuspensionesDeEmpresa(ctx, id) : Promise.resolve([]),
  ]);
  const pideActivacion = puedeEnOperacion(ctx, "plataforma.activacion.solicitar");
  const invita = puedeEnOperacion(ctx, "plataforma.invitacion.emitir");
  const pideSuspension = puedeEnOperacion(ctx, "plataforma.suspension.solicitar");
  const suspensionPendiente = suspensiones.find((suspension) => suspension.estado === "pendiente");
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
              {suspensionPendiente ? (
                <NotaRegla>
                  Hay una solicitud de {suspensionPendiente.tipo === "suspension" ? "suspensión" : "reactivación"} pendiente. Se decide en{" "}
                  <Link href="/operacion/aprobaciones">Aprobaciones</Link>.
                </NotaRegla>
              ) : pideSuspension && (cliente.estado === "activa" || cliente.estado === "suspendida") ? (
                <form action={solicitarSuspensionAccion}>
                  <input type="hidden" name="companyId" value={cliente.id} />
                  <input type="hidden" name="formId" value={randomUUID()} />
                  <input type="hidden" name="tipo" value={cliente.estado === "activa" ? "suspension" : "reactivacion"} />
                  <div className="campo">
                    <label htmlFor="motivo-suspension">Motivo</label>
                    <textarea
                      id="motivo-suspension"
                      name="motivo"
                      maxLength={500}
                      required
                      aria-describedby={veLista ? "motivo-suspension-pista" : undefined}
                      {...errorDelCampo(aviso, "motivo")}
                    />
                    {/* Quien escribe desde Cumplimiento: Originación y Aprobación leen este motivo (55ª). */}
                    {veLista ? (
                      <p id="motivo-suspension-pista" className="pista">Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.</p>
                    ) : null}
                  </div>
                  <div className="acciones">
                    <BotonEnviar>{cliente.estado === "activa" ? "Pedir suspensión" : "Pedir reactivación"}</BotonEnviar>
                    <p>La aprueba otra persona con rol de Aprobación.</p>
                  </div>
                </form>
              ) : null}
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
                <form action={invitarAdministradorAccion}>
                  <input type="hidden" name="companyId" value={cliente.id} />
                  <input type="hidden" name="vista" value={cliente.ultimaInvitacionId ?? ""} />
                  <div className="campo">
                    <label htmlFor="nombre">Nombre</label>
                    <input id="nombre" name="nombre" maxLength={200} defaultValue={cliente.administrador ?? ""} required />
                  </div>
                  <div className="campo">
                    <label htmlFor="correo">Correo</label>
                    <input
                      id="correo"
                      name="correo"
                      type="email"
                      maxLength={254}
                      defaultValue={cliente.administradorCorreo ?? ""}
                      required
                      {...errorDelCampo(aviso, "correo")}
                    />
                    {cliente.administrador ? <p className="pista">Reenviar anula el enlace anterior.</p> : null}
                  </div>
                  <div className="acciones">
                    <BotonEnviar>{cliente.administrador ? "Reenviar invitación" : "Enviar invitación"}</BotonEnviar>
                  </div>
                </form>
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
