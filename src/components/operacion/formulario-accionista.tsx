"use client";

import { useActionState, useEffect, useRef } from "react";

import { agregarAccionistaAccion, type EstadoDelSocio } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";
import { ETIQUETA_PEP, PEPS } from "@/dominio/operacion";

import { AvisoOperacion, errorDelCampo, MensajeDelCampo } from "./aviso";
import { useAvisoVigente } from "./formulario-con-aviso";
import { IdentidadDelSocio } from "./identidad-socio";

const ID_AVISO = "aviso-accionista";
const SIN_AVISO: EstadoDelSocio = { aviso: null, valores: {}, vuelta: 0 };

/**
 * Agregar un accionista al borrador. Si el servidor rechaza el socio, el formulario vuelve sin recargar
 * con todo lo capturado (tipo, nacionalidad, país, documento, fecha, nombre y porcentajes), el aviso
 * ligado al campo y el foco en ese campo; ningún dato personal pasa por la dirección. La clave `vuelta`
 * vuelve a montar los campos con lo capturado.
 */
export function FormularioAccionista({
  companyId,
  versionId,
  formId,
  morales,
  paises,
}: {
  companyId: string;
  versionId: string;
  formId: string;
  morales: ReadonlyArray<{ clave: string; nombre: string }>;
  paises: ReadonlyArray<{ codigo: string; nombre: string }>;
}) {
  const [estado, accion] = useActionState(agregarAccionistaAccion, SIN_AVISO);
  const forma = useRef<HTMLFormElement>(null);
  // Un solo campo marcado en la página: al enviarse otro formulario, el aviso de este se descarta.
  const aviso = useAvisoVigente(estado, forma);
  useEffect(() => {
    if (estado.vuelta) forma.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado.vuelta]);
  const valor = (campo: string) => estado.valores[campo] ?? "";
  const ligado = (campo: string) => errorDelCampo(aviso, campo, ID_AVISO);
  const mensaje = (campo: string) => <MensajeDelCampo codigo={aviso} campo={campo} idAviso={ID_AVISO} />;
  return (
    <form key={estado.vuelta} ref={forma} action={accion} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso ? (
        <div className="operacion-ancho">
          <AvisoOperacion codigo={aviso} id={ID_AVISO} />
        </div>
      ) : null}
      <div className="campo operacion-ancho">
        <label htmlFor="acc-padre">Es socio de</label>
        {mensaje("padreClave")}
        <select id="acc-padre" name="padreClave" defaultValue={valor("padreClave")} {...ligado("padreClave")}>
          <option value="">La empresa (socio directo)</option>
          {morales.map((moral) => (
            <option key={moral.clave} value={moral.clave}>
              {moral.nombre}
            </option>
          ))}
        </select>
      </div>
      <IdentidadDelSocio
        paises={paises}
        inicial={estado.valores}
        ligados={{
          rfc: ligado("rfc"),
          curp: ligado("curp"),
          pais: ligado("pais"),
          documentoExtranjero: ligado("documentoExtranjero"),
          fechaNacimiento: ligado("fechaNacimiento"),
        }}
        mensajes={{
          rfc: mensaje("rfc"),
          curp: mensaje("curp"),
          pais: mensaje("pais"),
          documentoExtranjero: mensaje("documentoExtranjero"),
          fechaNacimiento: mensaje("fechaNacimiento"),
        }}
      >
        <div className="campo">
          <label htmlFor="acc-nombre">Nombre o razón social</label>
          {mensaje("nombre")}
          <input id="acc-nombre" name="nombre" maxLength={300} required defaultValue={valor("nombre")} {...ligado("nombre")} />
        </div>
      </IdentidadDelSocio>
      <div className="campo">
        <label htmlFor="acc-capital">Capital (%)</label>
        {mensaje("capital")}
        <input id="acc-capital" name="capital" inputMode="decimal" maxLength={6} required defaultValue={valor("capital")} {...ligado("capital")} />
      </div>
      <div className="campo">
        <label htmlFor="acc-votos">Votos (%)</label>
        {mensaje("votos")}
        <input id="acc-votos" name="votos" inputMode="decimal" maxLength={6} required defaultValue={valor("votos")} {...ligado("votos")} />
      </div>
      <div className="campo">
        <label htmlFor="acc-pep">¿Es persona expuesta políticamente?</label>
        {mensaje("pep")}
        <select id="acc-pep" name="pep" defaultValue={valor("pep") || "no"} {...ligado("pep")}>
          {PEPS.map((pep) => (
            <option key={pep} value={pep}>
              {ETIQUETA_PEP[pep]}
            </option>
          ))}
        </select>
      </div>
      <label className="confirmacion operacion-ancho">
        <input name="controlOtrosMedios" type="checkbox" value="si" defaultChecked={valor("controlOtrosMedios") === "si"} />
        <span>Controla la empresa por otros medios (contrato, poder, parentesco)</span>
      </label>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Agregar accionista</BotonEnviar>
      </div>
    </form>
  );
}
