"use client";

import type { ReactNode } from "react";

import { solicitarSuspensionAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-suspension";

/**
 * Pedir la suspensión o la reactivación de una empresa, con motivo. Si el servidor lo rechaza, vuelve el motivo como
 * se escribió. `paraCumplimiento`: quien escribe desde Cumplimiento ve que Originación y Aprobación leen el motivo (55ª).
 * `pendiente` es la nota de una solicitud que ya espera decisión: va en lugar del formulario. Si otra persona la pidió
 * entre la vista y el envío, la página vuelve con esa nota y este aviso sigue arriba de ella.
 */
export function FormularioSuspension({
  companyId,
  formId,
  tipo,
  paraCumplimiento,
  pendiente,
}: {
  companyId: string;
  formId: string;
  tipo: "suspension" | "reactivacion";
  paraCumplimiento: boolean;
  pendiente: ReactNode;
}) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(solicitarSuspensionAccion, ID_AVISO);
  const motivo = ligado("motivo");
  if (pendiente) {
    return (
      <>
        {resumen}
        {pendiente}
      </>
    );
  }
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="tipo" value={tipo} />
      {resumen}
      <div className="campo">
        <label htmlFor="motivo-suspension">Motivo (de 10 a 500 caracteres)</label>
        {mensaje("motivo")}
        <textarea
          id="motivo-suspension"
          name="motivo"
          minLength={10}
          maxLength={500}
          required
          defaultValue={valor("motivo")}
          {...motivo}
          aria-describedby={[paraCumplimiento ? "motivo-suspension-pista" : "", motivo["aria-describedby"]].filter(Boolean).join(" ") || undefined}
        />
        {paraCumplimiento ? (
          <p id="motivo-suspension-pista" className="pista">Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.</p>
        ) : null}
      </div>
      <div className="acciones">
        <BotonEnviar>{tipo === "suspension" ? "Pedir suspensión" : "Pedir reactivación"}</BotonEnviar>
        <p>La aprueba otra persona con rol de Aprobación.</p>
      </div>
    </form>
  );
}
