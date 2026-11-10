"use client";

import { cargarListaAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";

import { LISTA_DEMASIADO_GRANDE } from "./aviso";
import { CampoArchivo } from "./campo-archivo";
import { useFormularioConAviso } from "./formulario-con-aviso";

/**
 * Cargar la lista vigente (CSV). Si el servidor la rechaza, el aviso va en este formulario, con la línea del renglón
 * malo, y no en la dirección: así en la página nunca quedan marcados a la vez el archivo y el campo de una coincidencia.
 */
export function FormularioLista({ formId }: { formId: string }) {
  const { forma, enviar, vuelta, ligado, mensaje, resumen } = useFormularioConAviso(cargarListaAccion, "aviso-lista");
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      <input type="hidden" name="formId" value={formId} />
      {resumen}
      <div className="campo">
        <label htmlFor="archivo">Archivo CSV</label>
        <CampoArchivo
          id="archivo"
          name="archivo"
          accept=".csv,text/csv"
          mensaje={LISTA_DEMASIADO_GRANDE}
          required
          ligado={ligado("archivo")}
          mensajeDelServidor={mensaje("archivo")}
        />
      </div>
      <div className="acciones">
        <BotonEnviar>Cargar y cotejar</BotonEnviar>
      </div>
    </form>
  );
}
