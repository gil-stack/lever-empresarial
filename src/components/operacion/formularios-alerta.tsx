"use client";

import { cerrarAlertaAccion, crearAlertaAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

type Opcion = { id: string; nombre: string };

/** Crear una alerta con su responsable. Si el servidor la rechaza, vuelve todo como se escribió. */
export function FormularioAlerta({ empresas, personal, responsable }: { empresas: Opcion[]; personal: Opcion[]; responsable: string }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(crearAlertaAccion, "aviso-alerta");
  const de = (campo: string, opciones: Opcion[], porOmision?: string) =>
    opciones.some((opcion) => opcion.id === valor(campo)) ? valor(campo) : porOmision;
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      {resumen}
      <div className="campo">
        <label htmlFor="companyId">Empresa</label>
        <select id="companyId" name="companyId" required defaultValue={de("companyId", empresas)}>
          {empresas.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="responsableId">Responsable</label>
        {mensaje("responsableId")}
        <select id="responsableId" name="responsableId" defaultValue={de("responsableId", personal, responsable)} required {...ligado("responsableId")}>
          {personal.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="titulo">Título</label>
        {mensaje("titulo")}
        <input id="titulo" name="titulo" maxLength={160} required defaultValue={valor("titulo")} {...ligado("titulo")} />
      </div>
      <div className="campo">
        <label htmlFor="detalle">Detalle</label>
        {mensaje("detalle")}
        <textarea id="detalle" name="detalle" maxLength={500} required defaultValue={valor("detalle")} {...ligado("detalle")} />
      </div>
      <div className="acciones">
        <BotonEnviar>Crear alerta</BotonEnviar>
      </div>
    </form>
  );
}

/**
 * Cerrar una alerta con su motivo. Cada alerta abierta lleva el suyo, con la clave de la alerta: si el servidor lo
 * rechaza, el aviso vuelve a esa alerta con el motivo como se escribió.
 */
export function FormularioCierre({ id }: { id: string }) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(cerrarAlertaAccion, `aviso-cierre-${id}`);
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      <input type="hidden" name="id" value={id} />
      {resumen}
      <div className="campo">
        <label htmlFor={`motivo-${id}`}>Motivo de cierre</label>
        {mensaje("motivo")}
        <input id={`motivo-${id}`} name="motivo" maxLength={500} required defaultValue={valor("motivo")} {...ligado("motivo")} />
      </div>
      <BotonEnviar className="boton-texto">Cerrar alerta</BotonEnviar>
    </form>
  );
}
