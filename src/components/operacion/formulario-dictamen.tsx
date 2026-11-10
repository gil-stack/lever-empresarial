"use client";

import { dictaminarAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-dictamen";
const RESULTADOS = ["aprobado", "observado", "rechazado"];

/** El dictamen de Cumplimiento sobre la versión enviada. Si el servidor lo rechaza, vuelven el resultado y el motivo. */
export function FormularioDictamen({
  companyId,
  versionId,
  formId,
  envio,
}: {
  companyId: string;
  versionId: string;
  formId: string;
  /** «Envió Omar · 8 nov 2026, 10:12» */
  envio: string;
}) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(dictaminarAccion, ID_AVISO);
  const resultado = RESULTADOS.includes(valor("resultado")) ? valor("resultado") : "";
  const motivo = ligado("motivo");
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="formId" value={formId} />
      {resumen}
      <p>{envio}. Quien armó o envió la versión no puede dictaminarla.</p>
      <div className="campo">
        <label htmlFor="dictamen-resultado">Resultado</label>
        {mensaje("resultado")}
        <select id="dictamen-resultado" name="resultado" required defaultValue={resultado} {...ligado("resultado")}>
          <option value="" disabled>
            Elige uno
          </option>
          <option value="aprobado">Aprobado</option>
          <option value="observado">Observado: hay que corregir</option>
          <option value="rechazado">Rechazado</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor="dictamen-motivo">Motivo (obligatorio si se observa o rechaza)</label>
        {mensaje("motivo")}
        <textarea
          id="dictamen-motivo"
          name="motivo"
          maxLength={500}
          defaultValue={valor("motivo")}
          {...motivo}
          aria-describedby={["dictamen-motivo-pista", motivo["aria-describedby"]].filter(Boolean).join(" ")}
        />
        <p id="dictamen-motivo-pista" className="pista">Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.</p>
      </div>
      <div className="acciones">
        <BotonEnviar>Registrar dictamen</BotonEnviar>
      </div>
    </form>
  );
}
