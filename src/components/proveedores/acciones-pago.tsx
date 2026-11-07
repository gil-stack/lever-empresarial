"use client";

import { useActionState } from "react";

import {
  cancelarPago,
  decidirPago,
  subirContrato,
} from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";
import { Aviso, BotonEnviar } from "@/components/sistema";

import { enviarSinReiniciar, useEnvioConBoton } from "./sin-reinicio";

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
  const { enviar, oprimido } = useEnvioConBoton(accion);
  const motivoFalla = estado.tipo === "invalido" && estado.campo === "motivo";
  if (!puedeAutorizar) return null;
  return (
    <div className="detalle-acciones">
      <h3>Revisión y autorización</h3>
      <p className="pista">
        {soloRechazo
          ? "Esta instrucción ya no puede autorizarse tal como está. Recházala con motivo para que quien la solicitó la corrija."
          : "Compara proveedor, importe y CLABE. Autorizar exige un segundo factor verificado en los últimos 30 minutos."}
      </p>
      {estado.tipo !== "inicial" ? <div id={`decision-${requestId}-aviso`}><Aviso tono={estado.tipo === "listo" ? "asentado" : "revisar"} titulo={estado.tipo === "listo" ? "Decisión asentada" : "No se completó"}>{estado.mensaje}</Aviso></div> : null}
      <form onSubmit={enviar}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="totalCentavos" value={totalCentavos} />
        <div className="campo">
          <label htmlFor={`motivo-${requestId}`}>Motivo al rechazar</label>
          <textarea id={`motivo-${requestId}`} name="motivo" rows={3} maxLength={500}
            aria-invalid={motivoFalla || undefined}
            aria-describedby={motivoFalla ? `motivo-${requestId}-pista decision-${requestId}-aviso` : `motivo-${requestId}-pista`} />
          <p className="pista" id={`motivo-${requestId}-pista`}>Obligatorio solo si rechazas.</p>
        </div>
        <div className="acciones acciones-divididas">
          <BotonEnviar className="boton-texto" name="decision" value="rechazar" pendiente={pendiente && oprimido === "rechazar"} disabled={pendiente}>Rechazar</BotonEnviar>
          {soloRechazo ? null : <BotonEnviar name="decision" value="autorizar" pendiente={pendiente && oprimido === "autorizar"} disabled={pendiente} onClick={(evento) => evento.preventDefault()}>Autorizar para pagar</BotonEnviar>}
        </div>
      </form>
    </div>
  );
}

const TEXTOS_CANCELACION = {
  propia: { resumen: "Cancelar mi solicitud", detalle: "La solicitud se cierra y el CFDI queda libre para capturarse de nuevo." },
  listo: { resumen: "Cancelar el pago autorizado", detalle: "Retira la autorización y cierra el pago. El motivo queda en la bitácora y en el historial." },
} as const;

export function Cancelacion({ requestId, tipo }: { requestId: string; tipo: keyof typeof TEXTOS_CANCELACION }) {
  const [estado, accion, pendiente] = useActionState(cancelarPago, ESTADO_PAGO_INICIAL);
  const textos = TEXTOS_CANCELACION[tipo];
  return (
    <details className="cancelacion">
      <summary>{textos.resumen}</summary>
      <p className="pista">{textos.detalle}</p>
      {estado.tipo === "listo" ? <p className="mensaje-exito" role="status">{estado.mensaje}</p> : null}
      <form onSubmit={enviarSinReiniciar(accion)}>
        <input type="hidden" name="requestId" value={requestId} />
        <div className="campo">
          <label htmlFor={`cancelar-${requestId}`}>Motivo de cancelación</label>
          <textarea id={`cancelar-${requestId}`} name="motivoCancelacion" rows={2} minLength={5} maxLength={500} required
            aria-invalid={estado.tipo === "invalido" || undefined}
            aria-describedby={estado.tipo === "invalido" ? `cancelar-${requestId}-error` : undefined} />
          {estado.tipo === "invalido" ? <p className="error-campo" id={`cancelar-${requestId}-error`} role="alert">{estado.mensaje}</p> : null}
        </div>
        <BotonEnviar className="boton-texto" pendiente={pendiente}>Confirmar cancelación</BotonEnviar>
      </form>
    </details>
  );
}

export function FormularioContrato({ supplierId }: { supplierId: string }) {
  const [estado, accion, pendiente] = useActionState(subirContrato, ESTADO_PAGO_INICIAL);
  const ligado = (campo: string) => estado.tipo === "invalido" && estado.campo === campo
    ? { "aria-invalid": true, "aria-describedby": `contrato-${supplierId}-aviso` }
    : {};
  return (
    <details className="agregar-documento">
      <summary>Agregar contrato</summary>
      {estado.tipo !== "inicial" ? <div id={`contrato-${supplierId}-aviso`}><Aviso tono={estado.tipo === "listo" ? "asentado" : "revisar"} titulo={estado.tipo === "listo" ? "Documento guardado" : "No se guardó"}>{estado.mensaje}</Aviso></div> : null}
      <form action={accion}>
        <input type="hidden" name="supplierId" value={supplierId} />
        <div className="campo"><label htmlFor={`contrato-nuevo-${supplierId}`}>Contrato en PDF</label><input id={`contrato-nuevo-${supplierId}`} name="contrato" type="file" accept="application/pdf,.pdf" required {...ligado("contrato")} /></div>
        <div className="formulario-pareja">
          <div className="campo"><label htmlFor={`desde-${supplierId}`}>Vigente desde</label><input id={`desde-${supplierId}`} name="vigenteDesde" type="date" /></div>
          <div className="campo"><label htmlFor={`hasta-${supplierId}`}>Vigente hasta</label><input id={`hasta-${supplierId}`} name="vigenteHasta" type="date" {...ligado("vigenteHasta")} /></div>
        </div>
        <BotonEnviar className="boton-texto" pendiente={pendiente}>Guardar el contrato</BotonEnviar>
      </form>
    </details>
  );
}
