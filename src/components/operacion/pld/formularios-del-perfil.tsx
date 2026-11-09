"use client";

import { declararPerfilAccion, registrarEvaluacionAccion, resolverPropuestaDePerfilAccion } from "@/app/operacion/(portal)/pld/acciones";
import { useConservaLoCapturado } from "@/components/operacion/pld/formularios-de-texto";
import { BotonEnviar } from "@/components/sistema";

type Montos = { pagosMonto: string; pagosOperaciones: string; nominaMonto: string; nominaOperaciones: string };

/** r2-base-N18: Cumplimiento aprueba o rechaza la propuesta de Originación. Rechazado, el motivo vuelve como se escribió. */
export function FormularioResolverPropuesta({ companyId, propuestaId }: { companyId: string; propuestaId: string }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(resolverPropuestaDePerfilAccion, "aviso-resolucion");
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="propuestaId" value={propuestaId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <div className="campo operacion-ancho">
        <label htmlFor="perfil-resolucion-motivo">Por qué la apruebas o la rechazas</label>
        <textarea id="perfil-resolucion-motivo" name="motivo" required minLength={10} maxLength={1000} defaultValue={valor("motivo")} {...ligado("motivo")} />
        {mensaje("motivo")}
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar name="decision" value="aprobada">Aprobar el cambio</BotonEnviar>
        <BotonEnviar name="decision" value="rechazada" className="boton boton-secundario">Rechazar</BotonEnviar>
      </div>
    </form>
  );
}

/** 25ª-27ª: Originación declara o cambia el perfil. Rechazado, los montos y el motivo vuelven como se escribieron. */
export function FormularioPerfil({
  companyId,
  formId,
  iniciales,
  conMotivo,
  boton,
  pista,
}: {
  companyId: string;
  formId: string;
  iniciales: Montos;
  conMotivo: boolean;
  boton: string;
  pista: string;
}) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(declararPerfilAccion, "aviso-perfil");
  const monto = (id: string, campo: keyof Montos, etiqueta: string, modo: "decimal" | "numeric") => (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} name={campo} inputMode={modo} required autoComplete="off" defaultValue={valor(campo, iniciales[campo])} {...ligado(campo)} />
      {mensaje(campo)}
    </div>
  );
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      {monto("perfil-pagos-monto", "pagosMonto", "Pagos a proveedores: monto máximo al mes (pesos)", "decimal")}
      {monto("perfil-pagos-operaciones", "pagosOperaciones", "Pagos a proveedores: número de pagos al mes", "numeric")}
      {monto("perfil-nomina-monto", "nominaMonto", "Nómina: monto máximo al mes (pesos)", "decimal")}
      {monto("perfil-nomina-operaciones", "nominaOperaciones", "Nómina: número de lotes al mes", "numeric")}
      {conMotivo ? (
        <div className="campo operacion-ancho">
          <label htmlFor="perfil-motivo">Motivo del cambio</label>
          <textarea id="perfil-motivo" name="motivo" required minLength={10} maxLength={1000} defaultValue={valor("motivo")} {...ligado("motivo")} />
          {mensaje("motivo")}
        </div>
      ) : (
        <input type="hidden" name="motivo" value="" />
      )}
      <div className="acciones operacion-ancho">
        <BotonEnviar>{boton}</BotonEnviar>
        <p>{pista}</p>
      </div>
    </form>
  );
}

/** 27ª: la evaluación semestral. Rechazada, la opción, los montos y la justificación vuelven como se escribieron. */
export function FormularioEvaluacion({ companyId, formId, iniciales }: { companyId: string; formId: string; iniciales: Montos }) {
  const { estado, enviar, forma, valor, ligado, mensaje, aviso } = useConservaLoCapturado(registrarEvaluacionAccion, "aviso-evaluacion");
  const perfil = valor("perfil", "mantiene");
  const monto = (id: string, campo: keyof Montos, etiqueta: string, modo: "decimal" | "numeric") => (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} name={campo} inputMode={modo} autoComplete="off" defaultValue={valor(campo, iniciales[campo])} {...ligado(campo)} />
      {mensaje(campo)}
    </div>
  );
  return (
    <form key={estado.vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="formId" value={formId} />
      {aviso ? <div className="operacion-ancho">{aviso}</div> : null}
      <fieldset className="opciones operacion-ancho" {...ligado("perfil")}>
        <legend>El perfil transaccional</legend>
        <label className="confirmacion">
          <input type="radio" name="perfil" value="mantiene" defaultChecked={perfil === "mantiene"} />
          <span>Se mantiene</span>
        </label>
        <label className="confirmacion">
          <input type="radio" name="perfil" value="cambia" defaultChecked={perfil === "cambia"} />
          <span>Cambia: registro los montos nuevos</span>
        </label>
        {mensaje("perfil")}
      </fieldset>
      {monto("evaluacion-pagos-monto", "pagosMonto", "Pagos: monto máximo al mes (si cambia)", "decimal")}
      {monto("evaluacion-pagos-operaciones", "pagosOperaciones", "Pagos: número al mes (si cambia)", "numeric")}
      {monto("evaluacion-nomina-monto", "nominaMonto", "Nómina: monto máximo al mes (si cambia)", "decimal")}
      {monto("evaluacion-nomina-operaciones", "nominaOperaciones", "Nómina: lotes al mes (si cambia)", "numeric")}
      <div className="campo operacion-ancho">
        <label htmlFor="evaluacion-justificacion">Qué revisaste y por qué</label>
        <textarea id="evaluacion-justificacion" name="justificacion" required minLength={10} maxLength={2000} defaultValue={valor("justificacion")} {...ligado("motivo")} />
        {mensaje("motivo")}
      </div>
      <div className="acciones operacion-ancho">
        <BotonEnviar>Registrar evaluación</BotonEnviar>
        <p>Si el grado de riesgo cambia, regístralo antes en «Grado de riesgo»: la evaluación toma el vigente.</p>
      </div>
    </form>
  );
}
