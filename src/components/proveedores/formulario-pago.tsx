"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import {
  enviarPago,
  prellenarCfdi,
  reenviarPago,
} from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";
import { Aviso, BotonEnviar } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { sumarDias, type OrigenPago } from "@/dominio/pagos-proveedores";
import { enEmpresa } from "@/nucleo/rutas";
import type { PagoVista, ProveedorPago } from "@/dominio/pagos-vistas";

import { enviarSinReiniciar } from "./sin-reinicio";

export function FormularioPago({
  empresaId,
  proveedores,
  proveedorInicial,
  hoy,
  edicion,
}: {
  empresaId: string;
  proveedores: ProveedorPago[];
  proveedorInicial?: string;
  hoy: string;
  edicion?: PagoVista;
}) {
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [estado, accion, pendiente] = useActionState(edicion ? reenviarPago : enviarPago, ESTADO_PAGO_INICIAL);
  const [lectura, inspeccionar, inspeccionando] = useActionState(prellenarCfdi, { tipo: "inicial" } as const);
  const [origen, setOrigen] = useState<OrigenPago>(edicion?.origen ?? "cfdi");
  const [supplierId, setSupplierId] = useState(edicion?.supplierId ?? proveedorInicial ?? "");
  const proveedor = proveedores.find((actual) => actual.id === supplierId);
  const [fechas, setFechas] = useState({
    emitidaEl: edicion?.emitidaEl ?? hoy,
    venceEl: edicion?.venceEl ?? hoy,
    programadaEl: edicion?.programadaEl ?? hoy,
  });
  const cfdi = lectura.tipo === "listo" ? lectura.cfdi : null;
  const hrefExito = estado.tipo === "listo" && estado.requestId
    ? enEmpresa(empresaId, `/consola/proveedores?pago=${estado.requestId}`)
    : null;

  function cambiarProveedor(id: string) {
    setSupplierId(id);
    const elegido = proveedores.find((actual) => actual.id === id);
    if (!edicion && elegido) {
      setFechas((actual) => ({ ...actual, venceEl: sumarDias(hoy, elegido.diasCredito), programadaEl: sumarDias(hoy, elegido.diasCredito) }));
    }
  }

  return (
    <form className="pago-formulario" onSubmit={enviarSinReiniciar(accion)}>
      <input type="hidden" name="clientRequestId" value={clientRequestId} />
      {edicion ? <input type="hidden" name="requestId" value={edicion.id} /> : null}
      <input type="hidden" name="origen" value={origen} />
      {edicion ? <input type="hidden" name="supplierId" value={supplierId} /> : null}
      {estado.tipo === "invalido" ? <Aviso titulo="No se guardó"><p>{estado.mensaje}</p></Aviso> : null}
      {estado.tipo === "listo" ? (
        <Aviso tono="asentado" titulo="Quedó en autorización">
          <p>{estado.mensaje}</p>
          {hrefExito ? <Link className="enlace-texto" href={hrefExito}>Ver el detalle del pago</Link> : null}
        </Aviso>
      ) : null}

      <section className="panel formulario-seccion" aria-labelledby="pago-proveedor-titulo">
        <div className="formulario-seccion-cabeza"><span>01</span><div><h2 id="pago-proveedor-titulo">Proveedor y origen</h2><p>A quién se paga y con qué comprobante.</p></div></div>
        <div className="campo">
          <label htmlFor="supplierId">Proveedor</label>
          <select id="supplierId" name={edicion ? undefined : "supplierId"} value={supplierId} disabled={Boolean(edicion)} required aria-describedby={proveedor ? "supplierId-pista" : undefined} onChange={(event) => cambiarProveedor(event.target.value)}>
            <option value="">Selecciona un proveedor</option>
            {proveedores.map((actual) => (
              <option key={actual.id} value={actual.id} disabled={!actual.activo || !actual.botonPago}>
                {actual.razonSocial} · {actual.rfc}{!actual.activo ? " · inactivo" : !actual.botonPago ? " · pago bloqueado" : ""}
              </option>
            ))}
          </select>
          {proveedor ? <p className="pista" id="supplierId-pista">CLABE terminación {proveedor.clabeFinal} · {proveedor.diasCredito} días de crédito.</p> : null}
        </div>
        <div className="selector-origen" role="group" aria-label="Origen del pago">
          <button type="button" className={origen === "cfdi" ? "activo" : ""} aria-pressed={origen === "cfdi"} disabled={Boolean(edicion)} onClick={() => setOrigen("cfdi")}>
            <strong>Con factura</strong><span>XML + PDF</span>
          </button>
          <button type="button" className={origen === "excepcion" ? "activo" : ""} aria-pressed={origen === "excepcion"} disabled={Boolean(edicion)} onClick={() => setOrigen("excepcion")}>
            <strong>Excepción</strong><span>Motivo + evidencia</span>
          </button>
        </div>
      </section>

      <section className="panel formulario-seccion" aria-labelledby="pago-documentos-titulo">
        <div className="formulario-seccion-cabeza"><span>02</span><div><h2 id="pago-documentos-titulo">Comprobantes</h2><p>{origen === "cfdi" ? "El XML dicta emisor, receptor, UUID e importe." : "La excepción siempre conserva su motivo y evidencia."}</p></div></div>
        {origen === "cfdi" && !edicion ? (
          <div className="campos-documentos">
            <label className="soltar-archivo" htmlFor="xml">
              <span className="soltar-archivo-icono">XML</span><strong>Factura electrónica</strong><span>{inspeccionando ? "Leyendo y validando…" : "Seleccionar archivo .xml"}</span>
              <input id="xml" name="xml" type="file" accept=".xml,application/xml,text/xml" required aria-invalid={lectura.tipo === "invalido" || undefined} aria-describedby={lectura.tipo === "invalido" ? "xml-error" : undefined} onChange={(event) => {
                const archivo = event.target.files?.[0];
                if (!archivo) return;
                const datos = new FormData(); datos.set("xml", archivo); startTransition(() => inspeccionar(datos));
              }} />
            </label>
            <label className="soltar-archivo" htmlFor="pdf">
              <span className="soltar-archivo-icono">PDF</span><strong>Representación impresa</strong><span>Seleccionar archivo .pdf</span>
              <input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf" required />
            </label>
          </div>
        ) : null}
        {origen === "excepcion" && !edicion ? (
          <label className="soltar-archivo" htmlFor="pdf">
            <span className="soltar-archivo-icono">PDF</span><strong>Evidencia de la obligación</strong><span>Contrato, estado de cuenta u otro soporte</span>
            <input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf" required />
          </label>
        ) : null}
        {edicion ? <p className="nota-edicion">Los documentos originales se conservan. Esta corrección no los reemplaza.</p> : null}
        {edicion?.origen === "excepcion" ? (
          <label className="soltar-archivo" htmlFor="pdf">
            <span className="soltar-archivo-icono">PDF</span><strong>Evidencia nueva</strong><span>Obligatoria si cambias el importe</span>
            <input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf" />
          </label>
        ) : null}
        {lectura.tipo === "invalido" ? <p className="error-campo" id="xml-error" role="alert">{lectura.mensaje}</p> : null}
        {cfdi || edicion?.origen === "cfdi" ? (
          <div className="cfdi-resumen" aria-live="polite">
            <div><span>UUID</span><strong>{cfdi?.uuid ?? edicion?.cfdiUuid}</strong></div>
            <div><span>Emisión</span><strong>{cfdi?.emitidaEl ?? edicion?.emitidaEl}</strong></div>
            <div><span>Total leído</span><strong>{formatoPesos(cfdi?.totalCentavos ?? edicion?.totalCentavos ?? 0)}</strong></div>
            <div><span>Referencia</span><strong>{cfdi?.referencia ?? edicion?.referencia}</strong></div>
          </div>
        ) : null}
      </section>

      <section className="panel formulario-seccion" aria-labelledby="pago-condiciones-titulo">
        <div className="formulario-seccion-cabeza"><span>03</span><div><h2 id="pago-condiciones-titulo">Importe y fechas</h2><p>El vencimiento y la fecha prevista responden a preguntas distintas.</p></div></div>
        {origen === "excepcion" ? (
          <div className="formulario-pareja">
            <div className="campo"><label htmlFor="monto">Importe MXN</label><input id="monto" name="monto" inputMode="decimal" placeholder="0.00" defaultValue={edicion ? (edicion.totalCentavos / 100).toFixed(2) : ""} required aria-describedby="monto-pista" /><p className="pista" id="monto-pista">Pesos con centavos.</p></div>
            <div className="campo"><label htmlFor="referencia">Referencia</label><input id="referencia" name="referencia" maxLength={120} defaultValue={edicion?.referencia} required aria-describedby="referencia-pista" /><p className="pista" id="referencia-pista">Contrato, servicio o folio interno.</p></div>
          </div>
        ) : null}
        <div className="formulario-tres">
          {origen === "excepcion" ? <div className="campo"><label htmlFor="emitidaEl">Fecha de la obligación</label><input id="emitidaEl" name="emitidaEl" type="date" value={fechas.emitidaEl} required onChange={(event) => setFechas({ ...fechas, emitidaEl: event.target.value })} /></div> : null}
          <div className="campo"><label htmlFor="venceEl">Vencimiento</label><input id="venceEl" name="venceEl" type="date" value={fechas.venceEl} required onChange={(event) => setFechas({ ...fechas, venceEl: event.target.value })} /></div>
          <div className="campo"><label htmlFor="programadaEl">Fecha prevista de pago</label><input id="programadaEl" name="programadaEl" type="date" min={hoy} value={fechas.programadaEl} required onChange={(event) => setFechas({ ...fechas, programadaEl: event.target.value })} /></div>
        </div>
        {origen === "excepcion" ? <div className="campo"><label htmlFor="motivoExcepcion">Por qué no hay factura</label><textarea id="motivoExcepcion" name="motivoExcepcion" rows={4} minLength={10} maxLength={500} defaultValue={edicion?.motivoExcepcion ?? ""} required aria-describedby="motivoExcepcion-pista" /><p className="pista" id="motivoExcepcion-pista">Quien autorice también lo lee.</p></div> : null}
      </section>

      <div className="formulario-final">
        <div><strong>{edicion ? "Volver a solicitar" : "Enviar a autorización"}</strong><p>Otra persona revisa proveedor, importe y CLABE antes de dejarlo listo para pagar.</p></div>
        <BotonEnviar pendiente={pendiente} disabled={inspeccionando || estado.tipo === "listo" || (origen === "cfdi" && !edicion && !cfdi)}>
          {edicion ? "Guardar y solicitar" : "Revisar y solicitar"}
        </BotonEnviar>
      </div>
    </form>
  );
}
