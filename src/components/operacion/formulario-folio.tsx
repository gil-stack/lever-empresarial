"use client";

import type { AccionConAviso } from "@/app/operacion/rechazo";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

/**
 * Anotar el folio del reporte a la UIF de una coincidencia confirmada. Cada tarjeta lleva el suyo, con la clave de la
 * coincidencia: si el servidor lo rechaza, el aviso vuelve a esa tarjeta con el folio y las fechas como se escribieron,
 * el campo que falló marcado y con el foco.
 */
export function FormularioFolio({ id, desde, accion }: { id: string; desde: "cumplimiento" | "lpb"; accion: AccionConAviso }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(accion, `aviso-folio-${id}`);
  return (
    <form key={vuelta} ref={forma} action={enviar} className="operacion-acciones">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="desde" value={desde} />
      {resumen}
      <div className="campo">
        <label htmlFor={`folio-${id}`}>Folio del reporte a la UIF</label>
        {mensaje("folio")}
        <input id={`folio-${id}`} name="folio" maxLength={80} required defaultValue={valor("folio")} {...ligado("folio")} />
      </div>
      <div className="campo">
        <label htmlFor={`presentado-${id}`}>Presentado el</label>
        {mensaje("presentadoEl")}
        <input id={`presentado-${id}`} name="presentadoEl" type="date" required defaultValue={valor("presentadoEl")} {...ligado("presentadoEl")} />
      </div>
      <div className="campo">
        <label htmlFor={`aviso-${id}`}>Aviso por escrito al cliente</label>
        {mensaje("avisoClienteEl")}
        <input id={`aviso-${id}`} name="avisoClienteEl" type="date" defaultValue={valor("avisoClienteEl")} {...ligado("avisoClienteEl")} />
      </div>
      <BotonEnviar className="boton-secundario">Anotar folio</BotonEnviar>
    </form>
  );
}
