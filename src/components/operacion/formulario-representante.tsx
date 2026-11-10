"use client";

import { useActionState, useEffect, useRef } from "react";

import { agregarRepresentanteAccion, type EstadoDelRepresentante } from "@/app/operacion/acciones-alta";
import { BotonEnviar } from "@/components/sistema";
import { CARGOS, ETIQUETA_CARGO, ETIQUETA_PEP, PEPS } from "@/dominio/operacion";

import { AvisoOperacion, errorDelCampo, MensajeDelCampo } from "./aviso";
import { useAvisoVigente } from "./formulario-con-aviso";

const ID_AVISO = "aviso-representante";
const SIN_AVISO: EstadoDelRepresentante = { aviso: null, valores: {}, vuelta: 0 };

/**
 * Agregar un representante al borrador. Como el del accionista: si el servidor lo rechaza, el formulario vuelve
 * sin recargar con lo capturado (nombre, RFC, CURP, cargo, PEP, quién lo designó y si administra), el aviso ligado
 * al campo y el foco en ese campo; ningún dato personal pasa por la dirección. La clave `vuelta` vuelve a montar
 * los campos con lo capturado.
 */
export function FormularioRepresentante({ companyId, versionId, formId }: { companyId: string; versionId: string; formId: string }) {
  const [estado, accion] = useActionState(agregarRepresentanteAccion, SIN_AVISO);
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
        <label htmlFor="rep-nombre">Nombre completo</label>
        {mensaje("nombre")}
        <input id="rep-nombre" name="nombre" maxLength={300} required defaultValue={valor("nombre")} {...ligado("nombre")} />
      </div>
      <div className="campo">
        <label htmlFor="rep-rfc">RFC</label>
        {mensaje("rfc")}
        <input id="rep-rfc" name="rfc" maxLength={13} autoCapitalize="characters" className="entrada-rfc" defaultValue={valor("rfc")} {...ligado("rfc")} />
      </div>
      <div className="campo">
        <label htmlFor="rep-curp">CURP</label>
        {mensaje("curp")}
        <input id="rep-curp" name="curp" maxLength={18} autoCapitalize="characters" defaultValue={valor("curp")} {...ligado("curp")} />
      </div>
      <div className="campo">
        <label htmlFor="rep-cargo">Cargo</label>
        {mensaje("cargo")}
        <select id="rep-cargo" name="cargo" defaultValue={valor("cargo") || "administrador_unico"} {...ligado("cargo")}>
          {CARGOS.map((cargo) => (
            <option key={cargo} value={cargo}>
              {ETIQUETA_CARGO[cargo]}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="rep-pep">¿Es persona expuesta políticamente?</label>
        {mensaje("pep")}
        <select id="rep-pep" name="pep" defaultValue={valor("pep") || "no"} {...ligado("pep")}>
          {PEPS.map((pep) => (
            <option key={pep} value={pep}>
              {ETIQUETA_PEP[pep]}
            </option>
          ))}
        </select>
      </div>
      <div className="campo operacion-ancho">
        <label htmlFor="rep-designado">Designado por</label>
        {mensaje("designadoPor")}
        <input
          id="rep-designado"
          name="designadoPor"
          maxLength={300}
          placeholder="Asamblea, poder notarial…"
          defaultValue={valor("designadoPor")}
          {...ligado("designadoPor")}
        />
      </div>
      <label className="confirmacion operacion-ancho">
        <input name="esAdministrador" type="checkbox" value="si" defaultChecked={valor("esAdministrador") === "si"} />
        <span>Administra la empresa (administrador único o consejo)</span>
      </label>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Agregar representante</BotonEnviar>
      </div>
    </form>
  );
}
