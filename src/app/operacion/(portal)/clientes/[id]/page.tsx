import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { invitarAdministradorAccion, solicitarActivacionAccion } from "@/app/operacion/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { etiquetaEstado, fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { EtiquetaMono, Hoja, Insignia, NotaRegla, Rejilla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import { exigirContextoOperacion, leerCliente, listarComisiones } from "@/server/operacion";

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
  const comisiones = await listarComisiones(ctx, id);
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
                <Renglon etiqueta="Régimen fiscal">{cliente.regimen}</Renglon>
                <Renglon etiqueta="Uso CFDI">{cliente.usoCfdi}</Renglon>
                <Renglon etiqueta="Administrador">{cliente.administrador ?? "Todavía no invitado"}</Renglon>
              </Renglones>
              {cliente.estado === "prospecto" ? (
                <form action={solicitarActivacionAccion}>
                  <input type="hidden" name="companyId" value={cliente.id} />
                  <div className="acciones">
                    <button className="boton" type="submit">Solicitar activación</button>
                    <p>Pasa a «En alta» y la decide otra persona.</p>
                  </div>
                </form>
              ) : null}
              {cliente.estado === "en_alta" ? (
                <NotaRegla>
                  La activación está pendiente. Se decide en <Link href="/operacion/aprobaciones">Aprobaciones</Link>.
                </NotaRegla>
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
              {cliente.estado === "activa" && cliente.administradorEstado !== "activa" ? (
                <form action={invitarAdministradorAccion}>
                  <input type="hidden" name="companyId" value={cliente.id} />
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
                    <button className="boton" type="submit">{cliente.administrador ? "Reenviar invitación" : "Enviar invitación"}</button>
                  </div>
                </form>
              ) : (
                <Vacio titulo={cliente.administradorEstado === "activa" ? "Ya entró" : "Primero, la activación"}>
                  {cliente.administradorEstado === "activa"
                    ? "El primer administrador aceptó su invitación."
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
                        {entrega.detalle ? ` · ${entrega.detalle}` : ""}
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
