"use client";

import { useActionState, useEffect, useRef } from "react";

import { registrarIntegrantesAccion, type EstadoDeIntegrantes } from "@/app/operacion/(portal)/pld/acciones";
import { AvisoOperacion, errorDelCampo, textoDelAviso } from "@/components/operacion/aviso";
import { useAvisoVigente } from "@/components/operacion/formulario-con-aviso";
import { MensajeJuntoAlCampo } from "@/components/operacion/mensaje-junto-al-campo";
import { BotonEnviar } from "@/components/sistema";
import { CARGO_COMITE, CARGOS_COMITE } from "@/dominio/pld/etiquetas";

const ID_AVISO = "aviso-integrantes";
const SIN_AVISO: EstadoDeIntegrantes = { aviso: null, renglon: null, valores: {}, vuelta: 0 };

/**
 * Los rechazos de la integración completa (47ª) no son de un renglón: se marcan en el campo que los resuelve del
 * primer renglón capturado. La sustitución tiene sus propios campos.
 */
const CAMPO_DE_INTEGRACION: Readonly<Record<string, string>> = {
  comite_sin_oficial: "esOficial",
  oficial_sin_rol_de_cumplimiento: "esOficial",
  comite_presidente_unico: "cargo",
  comite_secretario_unico: "cargo",
  comite_minimo_tres_titulares: "cargo",
  comite_un_suplente_por_titular: "cargo",
  comite_suplente_sin_titular: "suplenteDe",
  comite_persona_repetida: "rfc",
  comite_auditor_integrante: "rfc",
  comite_integrante_no_existe: "sustituye",
  comite_sustitucion_antes_de_designacion: "sustituidoEl",
};

type Opcion = { id: string; etiqueta: string };

/**
 * Integrantes del Comité con los 14 campos del aviso de la 49ª, cinco renglones a la vez (r2-serv-N1). Si el
 * servidor rechaza, el formulario vuelve sin recargar con lo capturado, el aviso arriba, el campo del renglón que
 * falló marcado y con el foco. Ningún dato personal pasa por la dirección. La clave `vuelta` vuelve a montar los
 * campos con lo capturado.
 */
export function FormularioIntegrantes({ ids, hoy, titulares, vigentes }: { ids: string[]; hoy: string; titulares: Opcion[]; vigentes: Opcion[] }) {
  const [estado, accion] = useActionState(registrarIntegrantesAccion, SIN_AVISO);
  const forma = useRef<HTMLFormElement>(null);
  // r2-serv-N20: el aviso vigente del #59 (oculta el del envío anterior; se descarta si se envía otro formulario).
  const aviso = useAvisoVigente(estado, forma);
  useEffect(() => {
    if (estado.vuelta) forma.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado.vuelta]);
  const valor = (campo: string) => estado.valores[campo] ?? "";
  const primerCapturado = ids.findIndex((_, i) => valor(`nombres-${i}`).trim() !== "");
  const delAviso = (campo: string) =>
    aviso !== null && (CAMPO_DE_INTEGRACION[aviso] === campo || Object.keys(errorDelCampo(aviso, campo)).length > 0);
  // El campo marcado lo describe su mensaje, junto a él; el aviso de arriba queda como resumen (onceava ronda del #59).
  const marca = { "aria-invalid": true, "aria-describedby": `${ID_AVISO}-campo` } as const;
  const mensajeDe = (marcado: object) =>
    "aria-invalid" in marcado && aviso ? <MensajeJuntoAlCampo id={`${ID_AVISO}-campo`} texto={textoDelAviso(aviso)} /> : null;
  /** El campo de un renglón: el del aviso en el renglón que falló, o en el primero capturado si es de la integración. */
  const ligado = (campo: string, i: number) => (delAviso(campo) && (estado.renglon ?? Math.max(primerCapturado, 0)) === i ? marca : {});
  /** Los campos de la sustitución, que no son de un renglón. */
  const ligadoFuera = (campo: string) => (estado.renglon === null && delAviso(campo) ? marca : {});
  return (
    <form key={estado.vuelta} ref={forma} action={accion} className="operacion-forma">
      <input type="hidden" name="renglones" value={ids.length} />
      {aviso ? <AvisoOperacion codigo={aviso} id={ID_AVISO} /> : null}
      <p>
        Llena un renglón por persona; los vacíos no se guardan. Todo va junto: la base revisa al final que quede un solo presidente y un solo secretario
        titulares, al menos tres titulares, un suplente por titular como máximo y al Oficial como integrante.
      </p>
      {ids.map((id, i) => (
        // La clave es el renglón, no su id: el id cambia cada vez que la página se vuelve a leer y el renglón se montaría
        // de nuevo en blanco (onceava ronda del #59).
        <fieldset key={i} className="formulario-pareja">
          <legend>Persona {i + 1}</legend>
          <input type="hidden" name={`id-${i}`} value={id} />
          <div className="campo">
            <label htmlFor={`integrante-nombres-${i}`}>Nombre(s)</label>
            <input id={`integrante-nombres-${i}`} name={`nombres-${i}`} maxLength={80} autoComplete="off" defaultValue={valor(`nombres-${i}`)} {...ligado("nombres", i)} />
            {mensajeDe(ligado("nombres", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-primer-${i}`}>Primer apellido</label>
            <input
              id={`integrante-primer-${i}`}
              name={`primerApellido-${i}`}
              maxLength={80}
              autoComplete="off"
              defaultValue={valor(`primerApellido-${i}`)}
              {...ligado("primerApellido", i)}
            />
            {mensajeDe(ligado("primerApellido", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-segundo-${i}`}>Segundo apellido (si tiene)</label>
            <input
              id={`integrante-segundo-${i}`}
              name={`segundoApellido-${i}`}
              maxLength={80}
              autoComplete="off"
              defaultValue={valor(`segundoApellido-${i}`)}
              {...ligado("segundoApellido", i)}
            />
            {mensajeDe(ligado("segundoApellido", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-cargo-${i}`}>Cargo en el Comité</label>
            <select id={`integrante-cargo-${i}`} name={`cargo-${i}`} defaultValue={valor(`cargo-${i}`) || "INTEGRANTE"} {...ligado("cargo", i)}>
              {CARGOS_COMITE.map((cargo) => (
                <option key={cargo} value={cargo}>
                  {CARGO_COMITE[cargo]}
                </option>
              ))}
            </select>
            {mensajeDe(ligado("cargo", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-titularidad-${i}`}>Titular o suplente</label>
            <select id={`integrante-titularidad-${i}`} name={`titularidad-${i}`} defaultValue={valor(`titularidad-${i}`) || "TITULAR"} {...ligado("titularidad", i)}>
              <option value="TITULAR">Titular</option>
              <option value="SUPLENTE">Suplente</option>
            </select>
            {mensajeDe(ligado("titularidad", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-suplente-${i}`}>Suplente de (si es suplente)</label>
            <select id={`integrante-suplente-${i}`} name={`suplenteDe-${i}`} defaultValue={valor(`suplenteDe-${i}`)} {...ligado("suplenteDe", i)}>
              <option value="">No aplica</option>
              {titulares.map((titular) => (
                <option key={titular.id} value={titular.id}>
                  {titular.etiqueta}
                </option>
              ))}
              {ids.slice(0, i).map((anterior, j) => (
                <option key={anterior} value={anterior}>
                  La persona {j + 1} de este formulario
                </option>
              ))}
            </select>
            {mensajeDe(ligado("suplenteDe", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-rfc-${i}`}>RFC con homoclave</label>
            <input
              id={`integrante-rfc-${i}`}
              name={`rfc-${i}`}
              maxLength={13}
              autoComplete="off"
              className="operacion-mono"
              defaultValue={valor(`rfc-${i}`)}
              {...ligado("rfc", i)}
            />
            {mensajeDe(ligado("rfc", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-curp-${i}`}>CURP</label>
            <input
              id={`integrante-curp-${i}`}
              name={`curp-${i}`}
              maxLength={18}
              autoComplete="off"
              className="operacion-mono"
              defaultValue={valor(`curp-${i}`)}
              {...ligado("curp", i)}
            />
            {mensajeDe(ligado("curp", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-area-${i}`}>Área de la entidad</label>
            <input id={`integrante-area-${i}`} name={`area-${i}`} maxLength={120} autoComplete="off" defaultValue={valor(`area-${i}`)} {...ligado("area", i)} />
            {mensajeDe(ligado("area", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-cargo-entidad-${i}`}>Cargo en la entidad</label>
            <input
              id={`integrante-cargo-entidad-${i}`}
              name={`cargoEntidad-${i}`}
              maxLength={120}
              autoComplete="off"
              defaultValue={valor(`cargoEntidad-${i}`)}
              {...ligado("cargoEntidad", i)}
            />
            {mensajeDe(ligado("cargoEntidad", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-designado-${i}`}>Fecha de designación</label>
            <input
              id={`integrante-designado-${i}`}
              name={`designadoEl-${i}`}
              type="date"
              max={hoy}
              defaultValue={valor(`designadoEl-${i}`) || hoy}
              {...ligado("designadoEl", i)}
            />
            {mensajeDe(ligado("designadoEl", i))}
          </div>
          <div className="campo">
            <label htmlFor={`integrante-certificado-${i}`}>Número de certificado (si tiene)</label>
            <input
              id={`integrante-certificado-${i}`}
              name={`certificado-${i}`}
              maxLength={22}
              autoComplete="off"
              defaultValue={valor(`certificado-${i}`)}
              {...ligado("certificado", i)}
            />
            {mensajeDe(ligado("certificado", i))}
          </div>
          <label className="confirmacion">
            <input type="checkbox" name={`esOficial-${i}`} value="si" defaultChecked={valor(`esOficial-${i}`) === "si"} {...ligado("esOficial", i)} />
            <span>Es el Oficial de Cumplimiento</span>
          </label>
          {mensajeDe(ligado("esOficial", i))}
        </fieldset>
      ))}
      {vigentes.length > 0 ? (
        <fieldset className="formulario-pareja">
          <legend>Sustitución (si alguien deja el Comité)</legend>
          <div className="campo">
            <label htmlFor="integrante-sustituye">Sustituye a</label>
            <select id="integrante-sustituye" name="sustituye" defaultValue={valor("sustituye")} {...ligadoFuera("sustituye")}>
              <option value="">Nadie</option>
              {vigentes.map((integrante) => (
                <option key={integrante.id} value={integrante.id}>
                  {integrante.etiqueta}
                </option>
              ))}
            </select>
            {mensajeDe(ligadoFuera("sustituye"))}
          </div>
          <div className="campo">
            <label htmlFor="integrante-sustituido">Fecha de sustitución</label>
            <input
              id="integrante-sustituido"
              name="sustituidoEl"
              type="date"
              max={hoy}
              defaultValue={valor("sustituidoEl") || hoy}
              {...ligadoFuera("sustituidoEl")}
            />
            {mensajeDe(ligadoFuera("sustituidoEl"))}
          </div>
          <div className="campo operacion-ancho">
            <label htmlFor="integrante-motivo">Motivo de la sustitución</label>
            <textarea id="integrante-motivo" name="motivo" maxLength={500} defaultValue={valor("motivo")} {...ligadoFuera("motivo")} />
            {mensajeDe(ligadoFuera("motivo"))}
          </div>
        </fieldset>
      ) : null}
      <div className="acciones">
        <BotonEnviar>Registrar en el Comité</BotonEnviar>
        <p>Los nombres se guardan en mayúsculas y sin acentos, como los pide el SITI.</p>
      </div>
    </form>
  );
}
