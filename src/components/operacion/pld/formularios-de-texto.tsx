"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  dictaminarCasoAccion,
  emitirAvisoAccion,
  registrarPropuestaAccion,
  type EstadoDelFormulario,
} from "@/app/operacion/(portal)/pld/acciones";
import { AvisoOperacion, errorDelCampo } from "@/components/operacion/aviso";
import { BotonEnviar } from "@/components/sistema";
import { PROPUESTA, PROPUESTAS, TIPO_AVISO, TIPOS_AVISO } from "@/dominio/pld/etiquetas";

const SIN_AVISO: EstadoDelFormulario = { aviso: null, valores: {}, vuelta: 0 };

/**
 * r2-serv-N14: un aviso, una propuesta o un dictamen rechazados vuelven sin recargar con lo capturado, el aviso arriba
 * y el foco en el campo marcado; el texto nunca pasa por la dirección. La clave `vuelta` vuelve a montar los campos.
 */
function useConservaLoCapturado(accion: (previo: EstadoDelFormulario, datos: FormData) => Promise<EstadoDelFormulario>, idAviso: string) {
  const [estado, enviar] = useActionState(accion, SIN_AVISO);
  const forma = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.vuelta) forma.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado.vuelta]);
  return {
    estado,
    enviar,
    forma,
    valor: (campo: string, inicial = "") => (estado.vuelta ? (estado.valores[campo] ?? inicial) : inicial),
    ligado: (campo: string) => errorDelCampo(estado.aviso, campo, idAviso),
    aviso: estado.aviso ? <AvisoOperacion codigo={estado.aviso} id={idAviso} /> : null,
  };
}

/** 54ª fr. VIII y 60ª: el aviso confidencial del personal a Cumplimiento. */
export function FormularioAviso({
  formId,
  clientes,
  personas,
}: {
  formId: string;
  clientes: Array<{ id: string; razonSocial: string }>;
  personas: Array<{ id: string; nombre: string }>;
}) {
  const { estado, enviar, forma, valor, ligado, aviso } = useConservaLoCapturado(emitirAvisoAccion, "aviso-nuevo");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="aviso-tipo">De qué se trata</label>
        <select id="aviso-tipo" name="tipo" required defaultValue={valor("tipo")} {...ligado("tipo")}>
          <option value="" disabled>
            Elige uno
          </option>
          {TIPOS_AVISO.map((tipo) => (
            <option key={tipo} value={tipo}>
              {TIPO_AVISO[tipo]}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="aviso-empresa">Empresa (si aplica)</label>
        <select id="aviso-empresa" name="companyId" defaultValue={valor("companyId")} {...ligado("companyId")}>
          <option value="">Ninguna en particular</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.razonSocial}
            </option>
          ))}
        </select>
      </div>
      <div className="campo operacion-ancho">
        <label htmlFor="aviso-descripcion">Qué viste, cuándo y quién estuvo involucrado</label>
        <textarea id="aviso-descripcion" name="descripcion" required minLength={20} maxLength={4000} defaultValue={valor("descripcion")} {...ligado("descripcion")} />
      </div>
      <div className="campo">
        <label htmlFor="aviso-mencionada">Persona del personal mencionada (si aplica)</label>
        <select id="aviso-mencionada" name="mencionada" defaultValue={valor("mencionada")} {...ligado("mencionada")}>
          <option value="">Nadie del personal</option>
          {personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="aviso-superior">Tu superior jerárquico (si no debe enterarse)</label>
        <select id="aviso-superior" name="superior" defaultValue={valor("superior")} {...ligado("superior")}>
          <option value="">No marcar a nadie</option>
          {personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Enviar aviso</BotonEnviar>
        <p>Las personas que marques no podrán ver este aviso, aunque tengan el rol de Cumplimiento.</p>
      </div>
    </form>
  );
}

/** La propuesta de quien analiza el caso: reportar o no, con su justificación. */
export function FormularioPropuesta({ casoId, formId, pista }: { casoId: string; formId: string; pista: string }) {
  const { estado, enviar, forma, valor, ligado, aviso } = useConservaLoCapturado(registrarPropuestaAccion, "aviso-propuesta");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="operacion-forma">
      <input type="hidden" name="casoId" value={casoId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso}
      <div className="campo">
        <label htmlFor="propuesta-propuesta">Propuesta</label>
        <select id="propuesta-propuesta" name="propuesta" required defaultValue={valor("propuesta")} {...ligado("propuesta")}>
          <option value="" disabled>
            Elige una
          </option>
          {PROPUESTAS.map((propuesta) => (
            <option key={propuesta} value={propuesta}>
              {PROPUESTA[propuesta]}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="propuesta-justificacion">Justificación</label>
        <textarea
          id="propuesta-justificacion"
          name="justificacion"
          required
          minLength={10}
          maxLength={4000}
          defaultValue={valor("justificacion")}
          {...ligado("motivo")}
        />
      </div>
      <div className="acciones">
        <BotonEnviar>Registrar propuesta</BotonEnviar>
        <p>{pista}</p>
      </div>
    </form>
  );
}

/**
 * El dictamen del caso. El Oficial elige el resultado; por el Comité, el resultado es el de la propuesta aprobada y
 * se elige la sesión.
 */
export function FormularioDictamen({
  casoId,
  formId,
  pista,
  oficial,
  comite,
}: {
  casoId: string;
  formId: string;
  pista: string;
  oficial?: { resultadoInicial: string };
  comite?: { propuestaId: string; resultado: string; sesiones: Array<{ id: string; etiqueta: string }> };
}) {
  const { estado, enviar, forma, valor, ligado, aviso } = useConservaLoCapturado(dictaminarCasoAccion, "aviso-dictamen");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="operacion-forma">
      <input type="hidden" name="casoId" value={casoId} />
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="via" value={comite ? "comite" : "oficial"} />
      {aviso}
      {comite ? (
        <>
          <input type="hidden" name="propuestaId" value={comite.propuestaId} />
          <input type="hidden" name="resultado" value="" />
          <p>
            Resultado: <strong>{comite.resultado}</strong>, como lo aprobó el Comité. La fecha del dictamen es la de la sesión.
          </p>
          <div className="campo">
            <label htmlFor="dictamen-sesion">Sesión</label>
            <select id="dictamen-sesion" name="sesionId" required defaultValue={valor("sesionId", comite.sesiones[0]?.id ?? "")} {...ligado("sesionId")}>
              {comite.sesiones.map((sesion) => (
                <option key={sesion.id} value={sesion.id}>
                  {sesion.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div className="campo">
          <label htmlFor="dictamen-resultado">Resultado</label>
          <select id="dictamen-resultado" name="resultado" required defaultValue={valor("resultado", oficial?.resultadoInicial ?? "")} {...ligado("resultado")}>
            <option value="" disabled>
              Elige uno
            </option>
            {PROPUESTAS.map((propuesta) => (
              <option key={propuesta} value={propuesta}>
                {PROPUESTA[propuesta]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="campo">
        <label htmlFor="dictamen-justificacion">Justificación</label>
        <textarea
          id="dictamen-justificacion"
          name="justificacion"
          required
          minLength={10}
          maxLength={4000}
          defaultValue={valor("justificacion")}
          {...ligado("motivo")}
        />
      </div>
      <div className="acciones">
        <BotonEnviar>Registrar dictamen</BotonEnviar>
        <p>{pista}</p>
      </div>
    </form>
  );
}
