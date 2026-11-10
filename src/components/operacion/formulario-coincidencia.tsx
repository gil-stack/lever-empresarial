"use client";

import { resolverCoincidenciaAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const ESTADOS = ["confirmada", "falso_positivo", "fuera_de_lista"];

/**
 * El dictamen de Cumplimiento sobre una coincidencia. Cada tarjeta lleva el suyo, con la clave de la coincidencia: si
 * el servidor lo rechaza, el aviso vuelve a esa tarjeta con lo elegido y lo escrito (sin JavaScript, React lo entrega
 * al formulario con la misma clave).
 */
export function FormularioCoincidencia({ id, desde }: { id: string; desde: "cumplimiento" | "lpb" }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(resolverCoincidenciaAccion, `aviso-coincidencia-${id}`);
  const estado = ESTADOS.includes(valor("estado")) ? valor("estado") : "";
  return (
    <form key={vuelta} ref={forma} action={enviar} className="operacion-acciones">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="desde" value={desde} />
      {resumen}
      <div className="campo">
        <label htmlFor={`resolucion-${id}`}>Dictamen</label>
        {mensaje("estado")}
        <select id={`resolucion-${id}`} name="estado" required defaultValue={estado} {...ligado("estado")}>
          <option value="" disabled>
            Elige uno
          </option>
          <option value="confirmada">Es la misma persona</option>
          <option value="falso_positivo">Falso positivo: es otra persona</option>
          <option value="fuera_de_lista">Ya no está en la lista vigente</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`motivo-${id}`}>Motivo (de 10 a 500 caracteres)</label>
        {mensaje("motivo")}
        <input id={`motivo-${id}`} name="motivo" minLength={10} maxLength={500} required defaultValue={valor("motivo")} {...ligado("motivo")} />
      </div>
      <BotonEnviar className="boton-secundario">Registrar dictamen</BotonEnviar>
    </form>
  );
}
