"use client";

import { useActionState } from "react";

import {
  cancelarPago,
  decidirPago,
  subirContrato,
} from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";
import { Aviso } from "@/components/sistema";

export function DecisionPago({ requestId, puedeAutorizar, puedeCancelar }: { requestId: string; puedeAutorizar: boolean; puedeCancelar: boolean }) {
  const [estado, accion, pendiente] = useActionState(decidirPago, ESTADO_PAGO_INICIAL);
  return (
    <div className="detalle-acciones">
      <h3>Revisión y autorización</h3>
      <p className="pista">Compara proveedor, importe y CLABE. Autorizar exige un segundo factor verificado en los últimos 30 minutos.</p>
      {estado.tipo !== "inicial" ? <Aviso tono={estado.tipo === "listo" ? "asentado" : "revisar"} titulo={estado.tipo === "listo" ? "Decisión asentada" : "No se completó"}>{estado.mensaje}</Aviso> : null}
      <form action={accion}>
        <input type="hidden" name="requestId" value={requestId} />
        <div className="campo">
          <label htmlFor={`motivo-${requestId}`}>Motivo al rechazar</label>
          <textarea id={`motivo-${requestId}`} name="motivo" rows={3} maxLength={500} placeholder="Obligatorio solo si rechazas" />
        </div>
        <div className="acciones acciones-divididas">
          {puedeAutorizar ? <button className="boton-secundario" type="submit" name="decision" value="rechazar" disabled={pendiente}>Rechazar</button> : null}
          {puedeAutorizar ? <button className="boton" type="submit" name="decision" value="autorizar" disabled={pendiente}>{pendiente ? "Verificando…" : "Autorizar para pagar"}</button> : null}
        </div>
      </form>
      {puedeCancelar ? <Cancelacion requestId={requestId} /> : null}
    </div>
  );
}

function Cancelacion({ requestId }: { requestId: string }) {
  const [estado, accion, pendiente] = useActionState(cancelarPago, ESTADO_PAGO_INICIAL);
  return (
    <details className="cancelacion">
      <summary>Cancelar mi solicitud</summary>
      {estado.tipo !== "inicial" ? <p className={estado.tipo === "listo" ? "mensaje-exito" : "error-campo"}>{estado.mensaje}</p> : null}
      <form action={accion}>
        <input type="hidden" name="requestId" value={requestId} />
        <div className="campo"><label htmlFor={`cancelar-${requestId}`}>Motivo de cancelación</label><textarea id={`cancelar-${requestId}`} name="motivoCancelacion" rows={2} minLength={5} required /></div>
        <button className="boton-texto" type="submit" disabled={pendiente}>Confirmar cancelación</button>
      </form>
    </details>
  );
}

export function FormularioContrato({ supplierId }: { supplierId: string }) {
  const [estado, accion, pendiente] = useActionState(subirContrato, ESTADO_PAGO_INICIAL);
  return (
    <details className="agregar-documento">
      <summary>Agregar contrato</summary>
      {estado.tipo !== "inicial" ? <Aviso tono={estado.tipo === "listo" ? "asentado" : "revisar"} titulo={estado.tipo === "listo" ? "Documento guardado" : "No se guardó"}>{estado.mensaje}</Aviso> : null}
      <form action={accion}>
        <input type="hidden" name="supplierId" value={supplierId} />
        <div className="campo"><label htmlFor={`contrato-nuevo-${supplierId}`}>Contrato PDF</label><input id={`contrato-nuevo-${supplierId}`} name="contrato" type="file" accept="application/pdf,.pdf" required /></div>
        <div className="formulario-pareja">
          <div className="campo"><label htmlFor={`desde-${supplierId}`}>Vigente desde</label><input id={`desde-${supplierId}`} name="vigenteDesde" type="date" /></div>
          <div className="campo"><label htmlFor={`hasta-${supplierId}`}>Vigente hasta</label><input id={`hasta-${supplierId}`} name="vigenteHasta" type="date" /></div>
        </div>
        <button className="boton-secundario" type="submit" disabled={pendiente}>{pendiente ? "Subiendo…" : "Guardar documento privado"}</button>
      </form>
    </details>
  );
}
