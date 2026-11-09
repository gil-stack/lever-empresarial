import { randomUUID } from "node:crypto";

import { declararPerfilAccion, registrarEvaluacionAccion, resolverPropuestaDePerfilAccion } from "@/app/operacion/(portal)/pld/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { BotonEnviar, Hoja, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { ETIQUETA_GRADO } from "@/dominio/operacion";
import type { ContextoDePersonal } from "@/nucleo/contexto";
import { puedeEnOperacion } from "@/server/operacion";
import { leerEvaluaciones, leerPerfiles, leerPropuestasDePerfil, type PerfilTransaccional as Perfil } from "@/server/pld";

const centavosATexto = (centavos: number) => (centavos / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * El perfil transaccional dentro del expediente (25ª-27ª). Muestra solo el perfil
 * y, a Cumplimiento y Auditoría, sus evaluaciones semestrales: nunca alertas,
 * casos ni conteos de PLD, porque Originación y Aprobación también ven esta página (55ª).
 */
export async function PerfilTransaccional({
  ctx,
  companyId,
  estado,
  aviso,
  en,
}: {
  ctx: ContextoDePersonal;
  companyId: string;
  estado: string;
  aviso?: string;
  en?: string;
}) {
  const perfiles = await leerPerfiles(ctx, companyId);
  const vigente = perfiles[0] ?? null;
  // r2-base-N18: con la empresa activa o suspendida, lo que captura Originación es una propuesta para Cumplimiento.
  const propone = estado === "activa" || estado === "suspendida";
  const propuestas = await leerPropuestasDePerfil(ctx, companyId);
  const pendiente = propuestas.find((p) => p.resolucion === null) ?? null;
  const ultimaResuelta = propuestas.find((p) => p.resolucion !== null) ?? null;
  const captura = puedeEnOperacion(ctx, "plataforma.expediente.capturar") && estado !== "baja" && !(propone && pendiente);
  const veEvaluaciones = puedeEnOperacion(ctx, "plataforma.pld.ver");
  const evalua = puedeEnOperacion(ctx, "plataforma.riesgo.calificar") && estado !== "baja";
  const resuelve = puedeEnOperacion(ctx, "plataforma.riesgo.calificar");
  const evaluaciones = veEvaluaciones ? await leerEvaluaciones(ctx, companyId) : [];
  const error = (seccion: string, campo: string) => (en === seccion ? errorDelCampo(aviso, campo) : {});

  return (
    <>
      <Hoja id="perfil-titulo" titulo="Perfil transaccional">
        {vigente ? (
          <>
            <Renglones>
              <Renglon etiqueta="Pagos a proveedores">
                {formatoPesos(vigente.pagosMontoMensualCentavos)} al mes · {vigente.pagosOperacionesMensuales} {vigente.pagosOperacionesMensuales === 1 ? "pago" : "pagos"}
              </Renglon>
              <Renglon etiqueta="Nómina">
                {formatoPesos(vigente.nominaMontoMensualCentavos)} al mes · {vigente.nominaOperacionesMensuales} {vigente.nominaOperacionesMensuales === 1 ? "lote" : "lotes"}
              </Renglon>
              <Renglon etiqueta="Versión">
                {vigente.numero} · {origen(vigente)} · {vigente.registradoPor} · {fechaHora(vigente.registradoEn)}
              </Renglon>
              {vigente.motivo ? <Renglon etiqueta="Motivo del cambio">{vigente.motivo}</Renglon> : null}
            </Renglones>
            {perfiles.length > 1 ? (
              <details className="operacion-detalle">
                <summary>Versiones anteriores ({perfiles.length - 1})</summary>
                <ul className="operacion-lista">
                  {perfiles.slice(1).map((perfil) => (
                    <li key={perfil.id}>
                      <div className="operacion-fila">
                        <div className="operacion-fila-cuerpo">
                          <h3>Versión {perfil.numero}</h3>
                          <p className="operacion-meta">
                            <span>Pagos {formatoPesos(perfil.pagosMontoMensualCentavos)} · {perfil.pagosOperacionesMensuales}</span>
                            <span>Nómina {formatoPesos(perfil.nominaMontoMensualCentavos)} · {perfil.nominaOperacionesMensuales}</span>
                            <span>{origen(perfil)} · {fechaHora(perfil.registradoEn)}</span>
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <Vacio titulo="Sin perfil declarado">
            Originación captura cuánto estima mover la empresa cada mes. Sin perfil la empresa no se puede activar.
          </Vacio>
        )}
        {pendiente ? (
          <div className="operacion-ficha">
            <div className="operacion-ficha-cabeza">
              <Insignia tono="aviso">Propuesta pendiente de Cumplimiento</Insignia>
              <p className="pista">El perfil vigente no cambia hasta que Cumplimiento la apruebe.</p>
            </div>
            <Renglones>
              <Renglon etiqueta="Pagos propuestos">
                {formatoPesos(pendiente.pagosMontoMensualCentavos)} al mes · {pendiente.pagosOperacionesMensuales} {pendiente.pagosOperacionesMensuales === 1 ? "pago" : "pagos"}
              </Renglon>
              <Renglon etiqueta="Nómina propuesta">
                {formatoPesos(pendiente.nominaMontoMensualCentavos)} al mes · {pendiente.nominaOperacionesMensuales} {pendiente.nominaOperacionesMensuales === 1 ? "lote" : "lotes"}
              </Renglon>
              <Renglon etiqueta="Motivo">{pendiente.motivo}</Renglon>
              <Renglon etiqueta="Propuso">{pendiente.propuestaPor} · {fechaHora(pendiente.propuestaEn)}</Renglon>
            </Renglones>
            {resuelve ? (
              <form action={resolverPropuestaDePerfilAccion} className="formulario-pareja operacion-forma">
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="propuestaId" value={pendiente.id} />
                <div className="campo operacion-ancho">
                  <label htmlFor="perfil-resolucion-motivo">Por qué la apruebas o la rechazas</label>
                  <textarea id="perfil-resolucion-motivo" name="motivo" required minLength={10} maxLength={1000} {...error("perfil-titulo", "motivo")} />
                </div>
                <div className="acciones operacion-ancho">
                  <BotonEnviar name="decision" value="aprobada">Aprobar el cambio</BotonEnviar>
                  <BotonEnviar name="decision" value="rechazada" className="boton boton-secundario">Rechazar</BotonEnviar>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
        {!pendiente && ultimaResuelta?.resolucion ? (
          <p className="pista">
            Última propuesta de Originación: {ultimaResuelta.resolucion.decision === "aprobada" ? "aprobada" : "rechazada"} por {ultimaResuelta.resolucion.por} el{" "}
            {fechaHora(ultimaResuelta.resolucion.en)}. {ultimaResuelta.resolucion.motivo}
          </p>
        ) : null}
        {captura ? (
          <form action={declararPerfilAccion} className="formulario-pareja operacion-forma">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="perfil-pagos-monto">Pagos a proveedores: monto máximo al mes (pesos)</label>
              <input id="perfil-pagos-monto" name="pagosMonto" inputMode="decimal" required autoComplete="off"
                defaultValue={vigente ? centavosATexto(vigente.pagosMontoMensualCentavos) : ""} {...error("perfil-titulo", "pagosMonto")} />
            </div>
            <div className="campo">
              <label htmlFor="perfil-pagos-operaciones">Pagos a proveedores: número de pagos al mes</label>
              <input id="perfil-pagos-operaciones" name="pagosOperaciones" inputMode="numeric" required autoComplete="off"
                defaultValue={vigente ? String(vigente.pagosOperacionesMensuales) : ""} {...error("perfil-titulo", "pagosOperaciones")} />
            </div>
            <div className="campo">
              <label htmlFor="perfil-nomina-monto">Nómina: monto máximo al mes (pesos)</label>
              <input id="perfil-nomina-monto" name="nominaMonto" inputMode="decimal" required autoComplete="off"
                defaultValue={vigente ? centavosATexto(vigente.nominaMontoMensualCentavos) : ""} {...error("perfil-titulo", "nominaMonto")} />
            </div>
            <div className="campo">
              <label htmlFor="perfil-nomina-operaciones">Nómina: número de lotes al mes</label>
              <input id="perfil-nomina-operaciones" name="nominaOperaciones" inputMode="numeric" required autoComplete="off"
                defaultValue={vigente ? String(vigente.nominaOperacionesMensuales) : ""} {...error("perfil-titulo", "nominaOperaciones")} />
            </div>
            {vigente || propone ? (
              <div className="campo operacion-ancho">
                <label htmlFor="perfil-motivo">Motivo del cambio</label>
                <textarea id="perfil-motivo" name="motivo" required minLength={10} maxLength={1000} {...error("perfil-titulo", "motivo")} />
              </div>
            ) : (
              <input type="hidden" name="motivo" value="" />
            )}
            <div className="acciones operacion-ancho">
              <BotonEnviar>{propone ? "Proponer el cambio a Cumplimiento" : vigente ? "Registrar cambio de perfil" : "Registrar perfil"}</BotonEnviar>
              <p>
                {propone
                  ? "La empresa ya opera: el perfil vigente no cambia hasta que Cumplimiento apruebe la propuesta."
                  : vigente
                    ? "La versión actual no cambia: queda la nueva como vigente."
                    : "Lo que la empresa declara que moverá como máximo cada mes."}
              </p>
            </div>
          </form>
        ) : null}
      </Hoja>

      {veEvaluaciones ? (
        <Hoja id="evaluacion-titulo" titulo="Evaluación semestral">
          {evaluaciones.length === 0 ? (
            <Vacio titulo="Sin evaluaciones">Cumplimiento evalúa el perfil y el grado de riesgo dos veces al año, una por semestre.</Vacio>
          ) : (
            <ul className="operacion-lista">
              {evaluaciones.map((evaluacion) => (
                <li key={evaluacion.id}>
                  <div className="operacion-fila">
                    <div className="operacion-fila-cuerpo">
                      <h3>
                        {evaluacion.semestre === 1 ? "Primer" : "Segundo"} semestre de {evaluacion.anio}
                      </h3>
                      <p className="operacion-meta">
                        <span>{fechaDia(evaluacion.evaluadaEl)}</span>
                        <span>Grado {ETIQUETA_GRADO[evaluacion.grado].toLowerCase()}</span>
                        <span>{evaluacion.registradoPor}</span>
                      </p>
                      <p>{evaluacion.justificacion}</p>
                    </div>
                    <Insignia tono={evaluacion.perfil === "cambia" ? "aviso" : "neutro"}>{evaluacion.perfil === "cambia" ? "Cambió el perfil" : "Mantiene el perfil"}</Insignia>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {evalua && vigente ? (
            <form action={registrarEvaluacionAccion} className="formulario-pareja operacion-forma">
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="formId" value={randomUUID()} />
              <fieldset className="campo operacion-ancho" {...error("evaluacion-titulo", "perfil")}>
                <legend>El perfil transaccional</legend>
                <label>
                  <input type="radio" name="perfil" value="mantiene" defaultChecked /> Se mantiene
                </label>
                <label>
                  <input type="radio" name="perfil" value="cambia" /> Cambia: registro los montos nuevos
                </label>
              </fieldset>
              <div className="campo">
                <label htmlFor="evaluacion-pagos-monto">Pagos: monto máximo al mes (si cambia)</label>
                <input id="evaluacion-pagos-monto" name="pagosMonto" inputMode="decimal" autoComplete="off" defaultValue={centavosATexto(vigente.pagosMontoMensualCentavos)} {...error("evaluacion-titulo", "pagosMonto")} />
              </div>
              <div className="campo">
                <label htmlFor="evaluacion-pagos-operaciones">Pagos: número al mes (si cambia)</label>
                <input id="evaluacion-pagos-operaciones" name="pagosOperaciones" inputMode="numeric" autoComplete="off" defaultValue={String(vigente.pagosOperacionesMensuales)} {...error("evaluacion-titulo", "pagosOperaciones")} />
              </div>
              <div className="campo">
                <label htmlFor="evaluacion-nomina-monto">Nómina: monto máximo al mes (si cambia)</label>
                <input id="evaluacion-nomina-monto" name="nominaMonto" inputMode="decimal" autoComplete="off" defaultValue={centavosATexto(vigente.nominaMontoMensualCentavos)} {...error("evaluacion-titulo", "nominaMonto")} />
              </div>
              <div className="campo">
                <label htmlFor="evaluacion-nomina-operaciones">Nómina: lotes al mes (si cambia)</label>
                <input id="evaluacion-nomina-operaciones" name="nominaOperaciones" inputMode="numeric" autoComplete="off" defaultValue={String(vigente.nominaOperacionesMensuales)} {...error("evaluacion-titulo", "nominaOperaciones")} />
              </div>
              <div className="campo operacion-ancho">
                <label htmlFor="evaluacion-justificacion">Qué revisaste y por qué</label>
                <textarea id="evaluacion-justificacion" name="justificacion" required minLength={10} maxLength={2000} {...error("evaluacion-titulo", "motivo")} />
              </div>
              <div className="acciones operacion-ancho">
                <BotonEnviar>Registrar evaluación</BotonEnviar>
                <p>Si el grado de riesgo cambia, regístralo antes en «Grado de riesgo»: la evaluación toma el vigente.</p>
              </div>
            </form>
          ) : null}
        </Hoja>
      ) : null}
    </>
  );
}

function origen(perfil: Perfil): string {
  if (perfil.origen === "evaluacion") return "cambiado en la evaluación de Cumplimiento";
  if (perfil.origen === "aprobacion") return "propuesto por Originación y aprobado por Cumplimiento";
  return "declarado por Originación";
}
