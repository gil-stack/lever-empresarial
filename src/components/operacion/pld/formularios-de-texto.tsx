"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  cambiarModoAccion,
  cambiarParametrosAccion,
  dictaminarCasoAccion,
  emitirAvisoAccion,
  registrarPropuestaAccion,
  type EstadoDelFormulario,
} from "@/app/operacion/(portal)/pld/acciones";
import { AvisoOperacion, errorDelCampo, MensajeDelCampo, permalinkDelRechazo } from "@/components/operacion/aviso";
import { useAvisoVigente } from "@/components/operacion/formulario-con-aviso";
import { BotonEnviar } from "@/components/sistema";
import { PROPUESTA, PROPUESTAS, TIPO_AVISO, TIPOS_AVISO } from "@/dominio/pld/etiquetas";

const SIN_AVISO: EstadoDelFormulario = { aviso: null, valores: {}, vuelta: 0 };

/**
 * r2-serv-N14: un formulario de PLD rechazado vuelve sin recargar con lo capturado, el aviso arriba y el foco en el
 * campo marcado; el texto nunca pasa por la dirección. También si el segundo factor venció mientras se escribía
 * (r2-serv-N17). La clave `vuelta` vuelve a montar los campos. Sin JavaScript, el servidor pinta el formulario con el
 * mismo estado: por eso lo capturado va en `defaultValue`/`defaultChecked` y no en un efecto.
 * r2-serv-N20: el aviso vigente es el de `useAvisoVigente` del #59: un rechazo oculta el aviso del envío anterior de
 * arriba de la página (`ResumenDelEnvio`) y, al enviarse otro formulario de la página, el de este se descarta.
 */
export function useConservaLoCapturado(accion: (previo: EstadoDelFormulario, datos: FormData) => Promise<EstadoDelFormulario>, idAviso: string) {
  const [estado, enviar] = useActionState(accion, SIN_AVISO, permalinkDelRechazo(idAviso));
  const forma = useRef<HTMLFormElement>(null);
  const vigente = useAvisoVigente(estado, forma);
  useEffect(() => {
    if (!estado.vuelta) return;
    // Un grupo de casillas marcado (fieldset) no recibe el foco: lo toma su primer control.
    const marcado = forma.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (marcado instanceof HTMLFieldSetElement ? marcado.querySelector<HTMLElement>("input, select, textarea") : marcado)?.focus();
  }, [estado.vuelta]);
  return {
    estado,
    enviar,
    forma,
    valor: (campo: string, inicial = "") => (estado.vuelta ? (estado.valores[campo] ?? inicial) : inicial),
    /** Una casilla de un grupo: tras un rechazo, marcada si venía marcada. */
    marcada: (campo: string, valor: string, inicial: boolean) => (estado.vuelta ? (estado.valores[campo] ?? "").split(",").includes(valor) : inicial),
    ligado: (campo: string) => errorDelCampo(vigente, campo, idAviso),
    mensaje: (campo: string) => <MensajeDelCampo codigo={vigente} campo={campo} idAviso={idAviso} />,
    aviso: vigente ? <AvisoOperacion codigo={vigente} id={idAviso} /> : null,
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
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(emitirAvisoAccion, "aviso-nuevo");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo">
        <label htmlFor="aviso-tipo">De qué se trata</label>
        {mensaje("tipo")}
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
        {mensaje("companyId")}
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
        {mensaje("descripcion")}
        <textarea id="aviso-descripcion" name="descripcion" required minLength={20} maxLength={4000} defaultValue={valor("descripcion")} {...ligado("descripcion")} />
      </div>
      <div className="campo">
        <label htmlFor="aviso-mencionada">Persona del personal mencionada (si aplica)</label>
        {mensaje("mencionada")}
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
        {mensaje("superior")}
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
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(registrarPropuestaAccion, "aviso-propuesta");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="operacion-forma">
      <input type="hidden" name="casoId" value={casoId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso}
      <div className="campo">
        <label htmlFor="propuesta-propuesta">Propuesta</label>
        {mensaje("propuesta")}
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
        {mensaje("motivo")}
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
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(dictaminarCasoAccion, "aviso-dictamen");
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
            {mensaje("sesionId")}
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
          {mensaje("resultado")}
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
        {mensaje("motivo")}
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

/** Los parámetros de las reglas de alerta (54ª): una versión nueva con su motivo. */
export function FormularioParametros({ formId, iniciales }: { formId: string; iniciales: Record<string, string> }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(cambiarParametrosAccion, "aviso-parametros");
  const numero = (id: string, campo: string, etiqueta: string, modo: "decimal" | "numeric") => (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {mensaje(campo)}
      <input id={id} name={campo} inputMode={modo} required defaultValue={valor(campo, iniciales[campo])} {...ligado(campo)} />
    </div>
  );
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      {numero("parametros-k", "atipicoK", "Monto atípico: veces la mediana (1 a 100)", "decimal")}
      {numero("parametros-historial", "atipicoHistorialMinimo", "Monto atípico: operaciones previas mínimas", "numeric")}
      {numero("parametros-n", "fraccionN", "Fraccionamiento: instrucciones mínimas (2 a 100)", "numeric")}
      {numero("parametros-ventana", "fraccionVentanaDias", "Fraccionamiento: ventana en días (1 a 90)", "numeric")}
      {numero("parametros-umbral", "fraccionUmbral", "Fraccionamiento: umbral en pesos", "decimal")}
      {numero("parametros-pct", "nominaPersonasPct", "Nómina atípica: aumento de personas en %", "decimal")}
      {numero("parametros-factor", "factorGradoAlto", "Grado alto: factor (más de 0 y hasta 1)", "decimal")}
      <div className="campo operacion-ancho">
        <label htmlFor="parametros-motivo">Motivo del cambio</label>
        {mensaje("motivo")}
        <textarea id="parametros-motivo" name="motivo" required minLength={10} maxLength={500} defaultValue={valor("motivo")} {...ligado("motivo")} />
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Guardar versión nueva</BotonEnviar>
        <p>La versión anterior no cambia. Las alertas ya generadas guardan los valores con que se calcularon.</p>
      </div>
    </form>
  );
}

/** Quién dictamina (47ª, último párrafo): el Comité o el Oficial de Cumplimiento, con motivo. */
export function FormularioModo({
  formId,
  modo,
  oficialId,
  personas,
}: {
  formId: string;
  modo: string;
  oficialId: string;
  personas: Array<{ id: string; nombre: string }>;
}) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(cambiarModoAccion, "aviso-modo");
  const elegido = valor("modo", modo);
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <fieldset className="opciones">
        <legend>Dictamina</legend>
        <label className="confirmacion">
          <input type="radio" name="modo" value="comite" defaultChecked={elegido === "comite"} />
          <span>El Comité</span>
        </label>
        <label className="confirmacion">
          <input type="radio" name="modo" value="oficial" defaultChecked={elegido === "oficial"} />
          <span>El Oficial de Cumplimiento</span>
        </label>
      </fieldset>
      <div className="campo">
        <label htmlFor="modo-oficial">Oficial de Cumplimiento (si dictamina el Oficial)</label>
        {mensaje("oficialId")}
        <select id="modo-oficial" name="oficialId" defaultValue={valor("oficialId", oficialId)} {...ligado("oficialId")}>
          <option value="">Elige a una persona de Cumplimiento</option>
          {personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo operacion-ancho">
        <label htmlFor="modo-motivo">Motivo del cambio</label>
        {mensaje("motivo")}
        <textarea id="modo-motivo" name="motivo" required minLength={10} maxLength={500} defaultValue={valor("motivo")} {...ligado("motivo")} />
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Guardar quién dictamina</BotonEnviar>
      </div>
    </form>
  );
}
