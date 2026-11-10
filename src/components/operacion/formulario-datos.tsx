"use client";

import { guardarDatosAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-datos";

type Campo = { nombre: string; etiqueta: string; extra?: Record<string, unknown> };

const CAMPOS: Campo[] = [
  { nombre: "razonSocial", etiqueta: "Razón social", extra: { maxLength: 300 } },
  { nombre: "rfc", etiqueta: "RFC", extra: { maxLength: 12, autoCapitalize: "characters", className: "entrada-rfc" } },
  { nombre: "giro", etiqueta: "Giro o actividad", extra: { maxLength: 200 } },
  { nombre: "nacionalidad", etiqueta: "Nacionalidad", extra: { maxLength: 80 } },
  { nombre: "fechaConstitucion", etiqueta: "Fecha de constitución", extra: { type: "date" } },
  { nombre: "serieEfirma", etiqueta: "Número de serie de la e.firma", extra: { inputMode: "numeric", maxLength: 20 } },
  { nombre: "domicilioCalle", etiqueta: "Calle", extra: { maxLength: 200 } },
  { nombre: "domicilioExterior", etiqueta: "Número exterior", extra: { maxLength: 40 } },
  { nombre: "domicilioInterior", etiqueta: "Número interior", extra: { maxLength: 40 } },
  { nombre: "domicilioColonia", etiqueta: "Colonia", extra: { maxLength: 120 } },
  { nombre: "domicilioMunicipio", etiqueta: "Municipio o alcaldía", extra: { maxLength: 120 } },
  { nombre: "domicilioEntidad", etiqueta: "Entidad", extra: { maxLength: 80 } },
  { nombre: "domicilioCodigoPostal", etiqueta: "Código postal", extra: { inputMode: "numeric", maxLength: 5 } },
  { nombre: "domicilioPais", etiqueta: "País", extra: { maxLength: 80 } },
  { nombre: "telefono", etiqueta: "Teléfono", extra: { inputMode: "tel", maxLength: 20 } },
  { nombre: "correo", etiqueta: "Correo", extra: { type: "email", maxLength: 254 } },
  { nombre: "volumenMensualCentavos", etiqueta: "Volumen mensual esperado (pesos)", extra: { inputMode: "decimal", maxLength: 20 } },
];

/**
 * Los datos generales del borrador. `guardados` es lo que hay en la base (el volumen ya en pesos). Si el servidor
 * rechaza un campo, vuelven los 17 como se escribieron, no lo guardado: nada de lo editado se pierde.
 */
export function FormularioDatos({ companyId, versionId, guardados }: { companyId: string; versionId: string; guardados: Record<string, string> }) {
  const { forma, enviar, vuelta, aviso, valor, ligado, mensaje, resumen } = useFormularioConAviso(guardarDatosAccion, ID_AVISO);
  return (
    <form key={vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="versionId" value={versionId} />
      {aviso ? <div className="operacion-ancho">{resumen}</div> : null}
      {CAMPOS.map(({ nombre, etiqueta, extra }) => (
        <div className="campo" key={nombre}>
          <label htmlFor={`dato-${nombre}`}>{etiqueta}</label>
          {mensaje(nombre)}
          <input id={`dato-${nombre}`} name={nombre} defaultValue={valor(nombre, guardados[nombre] ?? "")} {...extra} {...ligado(nombre)} />
        </div>
      ))}
      <div className="acciones operacion-ancho">
        <BotonEnviar>Guardar datos</BotonEnviar>
      </div>
    </form>
  );
}
