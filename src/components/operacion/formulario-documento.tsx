"use client";

import { cargarDocumentoAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";
import { TOPE_ARCHIVO_TEXTO } from "@/dominio/archivos";
import { ETIQUETA_DOCUMENTO, TIPOS_DOCUMENTO } from "@/dominio/operacion";

import { ARCHIVO_DEMASIADO_GRANDE } from "./aviso";
import { CampoArchivo } from "./campo-archivo";
import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-documento";
/** La e2e lo cita igual (tests/e2e/operacion.spec.ts). */
export const VUELVE_A_ELEGIR = "Vuelve a elegir el archivo: por seguridad, el navegador no lo guarda después de un rechazo. Lo demás sigue como lo escribiste.";

/**
 * Cargar un documento al borrador. Si el servidor lo rechaza, vuelven el tipo, el representante, las fechas y el
 * detalle; el archivo hay que elegirlo otra vez (el navegador no deja rellenar ese campo), y la nota lo dice junto a él.
 */
export function FormularioDocumento({
  companyId,
  versionId,
  formId,
  representantes,
}: {
  companyId: string;
  versionId: string;
  formId: string;
  representantes: { clave: string; nombre: string }[];
}) {
  const { forma, enviar, vuelta, aviso, valor, ligado, mensaje, resumen } = useFormularioConAviso(cargarDocumentoAccion, ID_AVISO);
  const tipo = (TIPOS_DOCUMENTO as readonly string[]).includes(valor("tipo")) ? valor("tipo") : "acta_constitutiva";
  const representante = representantes.some((r) => r.clave === valor("representanteClave")) ? valor("representanteClave") : "";
  return (
    <form key={vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{resumen}</div> : null}
      <div className="campo">
        <label htmlFor="doc-tipo">Documento</label>
        {mensaje("tipo")}
        <select id="doc-tipo" name="tipo" defaultValue={tipo} {...ligado("tipo")}>
          {TIPOS_DOCUMENTO.map((opcion) => (
            <option key={opcion} value={opcion}>
              {ETIQUETA_DOCUMENTO[opcion]}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="doc-representante">Representante (solo identificación y poder)</label>
        {mensaje("representanteClave")}
        <select id="doc-representante" name="representanteClave" defaultValue={representante} {...ligado("representanteClave")}>
          <option value="">No aplica</option>
          {representantes.map((opcion) => (
            <option key={opcion.clave} value={opcion.clave}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="doc-emitido">Emitido el</label>
        {mensaje("emitidoEl")}
        <input id="doc-emitido" name="emitidoEl" type="date" defaultValue={valor("emitidoEl")} {...ligado("emitidoEl")} />
      </div>
      <div className="campo">
        <label htmlFor="doc-vigente">Vigente hasta</label>
        {mensaje("vigenteHasta")}
        <input id="doc-vigente" name="vigenteHasta" type="date" defaultValue={valor("vigenteHasta")} {...ligado("vigenteHasta")} />
      </div>
      <div className="campo operacion-ancho">
        <label htmlFor="doc-detalle">Detalle (folio mercantil, notaría…)</label>
        {mensaje("detalle")}
        <input id="doc-detalle" name="detalle" maxLength={300} defaultValue={valor("detalle")} {...ligado("detalle")} />
      </div>
      <div className="campo operacion-ancho">
        <label htmlFor="doc-archivo">Archivo (PDF, PNG o JPG, hasta {TOPE_ARCHIVO_TEXTO})</label>
        <CampoArchivo
          id="doc-archivo"
          name="archivo"
          accept="application/pdf,image/png,image/jpeg"
          mensaje={ARCHIVO_DEMASIADO_GRANDE}
          required
          ligado={ligado("archivo")}
          mensajeDelServidor={mensaje("archivo")}
          nota={vuelta > 0 ? VUELVE_A_ELEGIR : undefined}
        />
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Guardar documento</BotonEnviar>
        <p>Se guarda con su huella SHA-256 y no se borra.</p>
      </div>
    </form>
  );
}
