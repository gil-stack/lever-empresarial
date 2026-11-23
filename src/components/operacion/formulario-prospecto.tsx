"use client";

import { registrarProspectoAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";

import { REGIMENES, USOS_CFDI } from "./formato";
import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-prospecto";

/**
 * Registrar un prospecto con su RFC (el primer paso del alta) y, si ya se sabe, quién será su primer administrador. Si el
 * servidor lo rechaza, vuelve todo lo capturado como se escribió.
 */
export function FormularioProspecto() {
  const { forma, enviar, vuelta, aviso, valor, ligado, mensaje, resumen } = useFormularioConAviso(registrarProspectoAccion, ID_AVISO);
  const opcion = (campo: string, opciones: readonly (readonly [string, string])[], porOmision: string) =>
    opciones.some(([clave]) => clave === valor(campo)) ? valor(campo) : porOmision;
  return (
    <form key={vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      {aviso ? <div className="operacion-ancho">{resumen}</div> : null}
      <div className="campo operacion-ancho">
        <label htmlFor="razonSocial">Razón social</label>
        {mensaje("razonSocial")}
        <input id="razonSocial" name="razonSocial" maxLength={254} required defaultValue={valor("razonSocial")} {...ligado("razonSocial")} />
      </div>
      <div className="campo">
        <label htmlFor="rfc">RFC</label>
        {mensaje("rfc")}
        <input
          className="entrada-rfc"
          id="rfc"
          name="rfc"
          minLength={12}
          maxLength={13}
          autoCapitalize="characters"
          required
          defaultValue={valor("rfc")}
          {...ligado("rfc")}
        />
      </div>
      <div className="campo">
        <label htmlFor="codigoPostal">Código postal</label>
        {mensaje("codigoPostal")}
        <input
          id="codigoPostal"
          name="codigoPostal"
          inputMode="numeric"
          minLength={5}
          maxLength={5}
          required
          defaultValue={valor("codigoPostal")}
          {...ligado("codigoPostal")}
        />
      </div>
      <div className="campo">
        <label htmlFor="regimen">Régimen fiscal</label>
        {mensaje("regimen")}
        <select id="regimen" name="regimen" defaultValue={opcion("regimen", REGIMENES, "601")} required {...ligado("regimen")}>
          {REGIMENES.map(([clave, nombre]) => (
            <option key={clave} value={clave}>
              {clave} · {nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="usoCfdi">Uso CFDI</label>
        {mensaje("usoCfdi")}
        <select id="usoCfdi" name="usoCfdi" defaultValue={opcion("usoCfdi", USOS_CFDI, "G03")} required {...ligado("usoCfdi")}>
          {USOS_CFDI.map(([clave, nombre]) => (
            <option key={clave} value={clave}>
              {clave} · {nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="operacion-ancho alta-seccion">
        <p className="alta-seccion-titulo">Primer administrador (opcional)</p>
        <p className="pista">
          Quien va a administrar la empresa en Lever. No le da acceso todavía: su invitación sale cuando la empresa esté activa y
          ya irá con estos datos.
        </p>
      </div>
      <div className="campo">
        <label htmlFor="contactoNombre">Nombre del administrador</label>
        {mensaje("contactoNombre")}
        <input
          id="contactoNombre"
          name="contactoNombre"
          maxLength={200}
          autoComplete="off"
          defaultValue={valor("contactoNombre")}
          {...ligado("contactoNombre")}
        />
      </div>
      <div className="campo">
        <label htmlFor="contactoCorreo">Correo del administrador</label>
        {mensaje("contactoCorreo")}
        <input
          id="contactoCorreo"
          name="contactoCorreo"
          type="email"
          maxLength={254}
          autoComplete="off"
          defaultValue={valor("contactoCorreo")}
          {...ligado("contactoCorreo")}
        />
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Registrar prospecto</BotonEnviar>
        <p>Queda como prospecto. Lo siguiente es el expediente.</p>
      </div>
    </form>
  );
}
