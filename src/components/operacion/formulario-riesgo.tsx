"use client";

import { calificarRiesgoAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";
import { ETIQUETA_NIVEL, type Nivel } from "@/dominio/operacion";

import { useFormularioConAviso } from "./formulario-con-aviso";

const NIVELES = Object.keys(ETIQUETA_NIVEL) as Nivel[];
const ID_AVISO = "aviso-riesgo";

/**
 * El grado de riesgo: actividad y zona las elige Cumplimiento. Ninguna arranca en un nivel, así que nada queda como
 * «baja» sin haberlo elegido. Si el servidor lo rechaza, vuelve lo elegido; un nivel que no es de la lista vuelve sin
 * elegir, nunca como «baja».
 */
export function FormularioRiesgo({ companyId, formId, periodica }: { companyId: string; formId: string; periodica: boolean }) {
  const { forma, enviar, vuelta, aviso, valor, ligado, mensaje, resumen } = useFormularioConAviso(calificarRiesgoAccion, ID_AVISO);
  const nivel = (campo: string) => {
    const elegido = valor(campo);
    return (NIVELES as string[]).includes(elegido) ? elegido : "";
  };
  const selector = (campo: "actividad" | "zona", etiqueta: string) => (
    <div className="campo">
      <label htmlFor={`riesgo-${campo}`}>{etiqueta}</label>
      {mensaje(campo)}
      <select id={`riesgo-${campo}`} name={campo} required defaultValue={nivel(campo)} {...ligado(campo)}>
        <option value="" disabled>
          Elige el nivel
        </option>
        {NIVELES.map((opcion) => (
          <option key={opcion} value={opcion}>
            {ETIQUETA_NIVEL[opcion]}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <form key={vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{resumen}</div> : null}
      {selector("actividad", "Riesgo de la actividad")}
      {selector("zona", "Riesgo de la zona geográfica")}
      <div className="acciones operacion-ancho">
        <BotonEnviar>{periodica ? "Registrar revisión periódica" : "Registrar grado al alta"}</BotonEnviar>
        <p>Antigüedad, capas, persona expuesta, volumen y coincidencias salen del expediente.</p>
      </div>
    </form>
  );
}
