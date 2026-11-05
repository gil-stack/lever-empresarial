"use client";

import { useActionState } from "react";

import {
  cancelarPago,
  decidirPago,
  subirContrato,
} from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";
import { Aviso } from "@/components/sistema";

/**
 * La decisión viaja con la versión y el importe que la persona tiene en
 * pantalla. Si la solicitud cambió desde que abrió el detalle, no se aplica.
 */
export function DecisionPago({ requestId, version, totalCentavos, puedeAutorizar, soloRechazo }: {
  requestId: string;
  version: number;
  totalCentavos: number;
  puedeAutorizar: boolean;
  soloRechazo: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(decidirPago, ESTADO_PAGO_INICIAL);
  if (!puedeAutorizar) return null;
  return (
    <div className="detalle-acciones">
      <h3>Revisión y autorización</h3>
      <p className="pista">
        {soloRechazo
          ? "Esta instrucción ya no puede autorizarse tal como está. Recházala con motivo para que quien la solicitó la corrija."
          : "Compara proveedor, importe y CLABE. Autorizar exige un segundo factor verificado en los últimos 30 minutos."}
      </p>
      {estado.tipo !== "inicial" ? <Aviso tono={estado.tipo === "listo" ? "asentado" : "revisar"} titulo={estado.tipo === "listo" ? "Decisión asentada" : "No se completó"}>{estado.mensaje}</Aviso> : null}
      <form action={accion}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="totalCentavos" value={totalCentavos} />
        <div className="campo">
          <label htmlFor={`motivo-${requestId}`}>Motivo al rechazar</label>
          <textarea id={`motivo-${requestId}`} name="motivo" rows={3} maxLength={500} placeholder="Obligatorio solo si rechazas" />
        </div>
        <div className="acciones acciones-divididas">
          <button className="boton-secundario" type="submit" name="decision" value="rechazar" disabled={pendiente}>Rechazar</button>
          {soloRechazo ? null : <button className="boton" type="submit" name="decision" value="autorizar" disabled={pendiente}>{pendiente ? "Verificando…" : "Autorizar para pagar"}</button>}
        </div>
      </form>
    </div>
  );
}

const TEXTOS_CANCELACION = {
  propia: { resumen: "Cancelar mi solicitud", detalle: "La solicitud se cierra y el CFDI queda libre para capturarse de nuevo." },
  listo: { resumen: "Cancelar pago listo para pagar", detalle: "Retira la autorización antes de cualquier envío. El motivo queda en la bitácora y en el historial." },
} as const;

export function Cancelacion({ requestId, tipo }: { requestId: string; tipo: keyof typeof TEXTOS_CANCELACION }) {
  const [estado, accion, pendiente] = useActionState(cancelarPago, ESTADO_PAGO_INICIAL);
  const textos = TEXTOS_CANCELACION[tipo];
  return (
    <details className="cancelacion">
      <summary>{textos.resumen}</summary>
      <p className="pista">{textos.detalle}</p>
      {estado.tipo !== "inicial" ? <p className={estado.tipo === "listo" ? "mensaje-exito" : "error-campo"} role="status">{estado.mensaje}</p> : null}
      <form action={accion}>
        <input type="hidden" name="requestId" value={requestId} />
        <div className="campo"><label htmlFor={`cancelar-${requestId}`}>Motivo de cancelación</label><textarea id={`cancelar-${requestId}`} name="motivoCancelacion" rows={2} minLength={5} maxLength={500} required /></div>
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
