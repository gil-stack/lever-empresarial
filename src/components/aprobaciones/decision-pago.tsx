"use client";

import { createContext, useActionState, useContext, useEffect, useId, useState, type ReactNode } from "react";

import { decidirPago } from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";
import { enviarSinReiniciar, useEnvioConBoton } from "@/components/proveedores/sin-reinicio";
import { Aviso, BotonEnviar, Dialogo } from "@/components/sistema";

const AvisarDecision = createContext<(texto: string) => void>(() => {});

/**
 * Al decidir, la acción vuelve a pintar la página y la fila decidida ya no
 * está. El aviso vive aquí, fuera de las filas, para que la confirmación no se
 * vaya con ella.
 */
export function ConAvisoDeDecision({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <AvisarDecision value={setAviso}>
      <div className="aprobaciones-aviso" aria-live="polite">
        {aviso ? <Aviso tono="asentado" titulo="Decisión asentada">{aviso}</Aviso> : null}
      </div>
      {children}
    </AvisarDecision>
  );
}

/**
 * Autorizar o rechazar un pago desde la bandeja con la misma acción y las
 * mismas reglas que el detalle de Proveedores: la decisión viaja con la
 * versión y el importe que la persona tiene en pantalla, autorizar exige un
 * segundo factor reciente y rechazar pide el motivo.
 */
export function DecisionPagoEnBandeja({
  requestId,
  version,
  totalCentavos,
  proveedor,
  soloRechazo,
}: {
  requestId: string;
  version: number;
  totalCentavos: number;
  proveedor: string;
  soloRechazo: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(decidirPago, ESTADO_PAGO_INICIAL);
  const { enviar, oprimido } = useEnvioConBoton(accion);
  const [abierto, setAbierto] = useState(false);
  const avisar = useContext(AvisarDecision);
  const motivo = useId();
  const error = `${motivo}-error`;

  useEffect(() => {
    if (estado.tipo !== "listo") return;
    setAbierto(false);
    avisar(`${proveedor}: ${estado.mensaje}`);
  }, [avisar, estado, proveedor]);

  const motivoFalla = estado.tipo === "invalido" && estado.campo === "motivo";
  const ocultos = (
    <>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="totalCentavos" value={totalCentavos} />
    </>
  );
  return (
    <>
      {estado.tipo === "invalido" && !abierto ? (
        <p className="error-campo aprobaciones-error" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <button type="button" className="boton-texto" data-atajo="rechazar" disabled={pendiente} onClick={() => setAbierto(true)}>
        Rechazar
      </button>
      {soloRechazo ? null : (
        <form onSubmit={enviarSinReiniciar(accion)}>
          {ocultos}
          <BotonEnviar name="decision" value="autorizar" data-atajo="aprobar" pendiente={pendiente} enviando="Autorizando…">
            Autorizar
          </BotonEnviar>
        </form>
      )}
      <Dialogo
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Rechazar el pago"
        explicacion={`Vas a rechazar el pago a ${proveedor}. Quien lo solicitó ve el motivo y puede corregirlo; queda en la bitácora.`}
        pie={null}
      >
        <form onSubmit={enviar} className="aprobaciones-dialogo-forma">
          {ocultos}
          <div className="campo">
            <label htmlFor={motivo}>Motivo</label>
            <textarea
              id={motivo}
              name="motivo"
              rows={3}
              maxLength={500}
              required
              minLength={5}
              aria-invalid={motivoFalla || undefined}
              aria-describedby={estado.tipo === "invalido" ? error : undefined}
            />
            {estado.tipo === "invalido" ? (
              <p className="error-campo" id={error} role="alert">
                {estado.mensaje}
              </p>
            ) : null}
          </div>
          <div className="dialogo-pie">
            <button type="button" className="boton-texto" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <BotonEnviar name="decision" value="rechazar" pendiente={pendiente && oprimido === "rechazar"} disabled={pendiente}>
              Rechazar
            </BotonEnviar>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
