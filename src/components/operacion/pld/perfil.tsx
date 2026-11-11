import { randomUUID } from "node:crypto";

import { idDeAncla } from "@/components/operacion/envio-sin-script";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { FormularioEvaluacion, FormularioPerfil, FormularioResolverPropuesta } from "@/components/operacion/pld/formularios-del-perfil";
import { Hoja, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { ETIQUETA_GRADO } from "@/dominio/operacion";
import type { ContextoDePersonal } from "@/nucleo/contexto";
import { puedeEnOperacion } from "@/server/operacion";
import { leerEvaluaciones, leerPerfiles, leerPropuestasDePerfil, type PerfilTransaccional as Perfil } from "@/server/pld";

const centavosATexto = (centavos: number) => (centavos / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Los montos del perfil vigente como los muestra el formulario; sin perfil, vacíos. */
const montosDe = (perfil: Perfil | null) => ({
  pagosMonto: perfil ? centavosATexto(perfil.pagosMontoMensualCentavos) : "",
  pagosOperaciones: perfil ? String(perfil.pagosOperacionesMensuales) : "",
  nominaMonto: perfil ? centavosATexto(perfil.nominaMontoMensualCentavos) : "",
  nominaOperaciones: perfil ? String(perfil.nominaOperacionesMensuales) : "",
});

/**
 * El perfil transaccional dentro del expediente (25ª-27ª). Muestra solo el perfil
 * y, a Cumplimiento y Auditoría, sus evaluaciones semestrales: nunca alertas,
 * casos ni conteos de PLD, porque Originación y Aprobación también ven esta página (55ª).
 */
export async function PerfilTransaccional({
  ctx,
  companyId,
  estado,
}: {
  ctx: ContextoDePersonal;
  companyId: string;
  estado: string;
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
  // B5: la bandeja enlaza aquí con #perfil-titulo y #evaluacion-titulo. En la respuesta a un envío sin JavaScript los
  // destinos llevan sufijo (idDeAncla del #59): el fragmento ya no coincide y el foco llega al campo rechazado.
  const [anclaPerfil, anclaEvaluacion] = await Promise.all([idDeAncla("perfil-titulo"), idDeAncla("evaluacion-titulo")]);

  return (
    <>
      <Hoja id={anclaPerfil} titulo="Perfil transaccional">
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
            {propone
              ? "La empresa ya opera sin perfil: sus pagos y su nómina no se comparan contra uno. Originación lo propone y Cumplimiento lo aprueba."
              : "Originación captura cuánto estima mover la empresa cada mes. Sin perfil la empresa no se puede activar."}
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
              <FormularioResolverPropuesta companyId={companyId} propuestaId={pendiente.id} />
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
          <FormularioPerfil
            companyId={companyId}
            formId={randomUUID()}
            iniciales={montosDe(vigente)}
            conMotivo={vigente !== null || propone}
            boton={propone ? "Proponer el cambio a Cumplimiento" : vigente ? "Registrar cambio de perfil" : "Registrar perfil"}
            pista={
              propone
                ? "La empresa ya opera: el perfil vigente no cambia hasta que Cumplimiento apruebe la propuesta."
                : vigente
                  ? "La versión actual no cambia: queda la nueva como vigente."
                  : "Lo que la empresa declara que moverá como máximo cada mes."
            }
          />
        ) : null}
      </Hoja>

      {veEvaluaciones ? (
        <Hoja id={anclaEvaluacion} titulo="Evaluación semestral">
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
            <FormularioEvaluacion companyId={companyId} formId={randomUUID()} iniciales={montosDe(vigente)} />
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
