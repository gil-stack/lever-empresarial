import Link from "next/link";

import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { plazoEnDias, plazoEnDiasHabiles } from "@/components/operacion/pld/formato";
import { Hoja, Insignia, Metrica, Metricas, Monto, Vacio } from "@/components/sistema";
import { nombreDelMes } from "@/dominio/flujo/fechas";
import { PROPUESTA, REGLA } from "@/dominio/pld";
import type { BandejaPld } from "@/server/pld";

/**
 * Lo de PLD en la bandeja de Cumplimiento (calculado al leer): alertas por analizar
 * con sus días, dictámenes por reportar en días hábiles, reportes periódicos,
 * evaluaciones semestrales y avisos de integración del Comité. Solo la ven
 * Cumplimiento y Auditoría, igual que la bandeja.
 */
export function BandejaDePld({ bandeja }: { bandeja: BandejaPld }) {
  const periodicos = bandeja.periodicos.filter((p) => p.estado !== "registrado");
  const comite =
    bandeja.comunicacionesComite.length + bandeja.mesesSinSesion.length + (bandeja.modo === "comite" && bandeja.sesionDelMesPendiente ? 1 : 0);
  return (
    <>
      <Metricas etiqueta="PLD">
        <Metrica rotulo="Alertas PLD" nota="Por analizar">
          <Monto>{bandeja.alertasSinCaso.length}</Monto>
        </Metrica>
        <Metrica rotulo="Por reportar" nota="Dictámenes sin acuse">
          <Monto>{bandeja.porReportar.length}</Monto>
        </Metrica>
        <Metrica rotulo="Reportes periódicos" nota="Por vencer o vencidos">
          <Monto>{periodicos.length}</Monto>
        </Metrica>
        <Metrica rotulo="Evaluaciones" nota="Semestrales y cambios de perfil">
          <Monto>{bandeja.evaluaciones.length + bandeja.propuestasDePerfil.length}</Monto>
        </Metrica>
      </Metricas>

      <Hoja id="pld-alertas-titulo" titulo="Alertas PLD por analizar">
        {bandeja.alertasSinCaso.length === 0 ? (
          <Vacio titulo="Sin alertas por analizar">Las alertas de las reglas y los avisos del personal aparecen aquí con sus días.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.alertasSinCaso.map((alerta) => (
              <li key={alerta.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href="/operacion/pld#alertas-titulo">
                        {REGLA[alerta.regla].titulo}
                        {alerta.razonSocial ? ` · ${alerta.razonSocial}` : ""}
                      </Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>Generada {fechaHora(alerta.creadaEn)}</span>
                      <span>Vence el {fechaDia(alerta.venceEl)}</span>
                    </p>
                  </div>
                  <Insignia tono={alerta.fueraDePlazo || alerta.diasRestantes <= 10 ? "aviso" : "neutro"}>{plazoEnDias(alerta.diasRestantes)}</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <Hoja id="pld-reportar-titulo" titulo="Dictámenes por reportar">
        {bandeja.porReportar.length === 0 ? (
          <Vacio titulo="Nada por reportar">Un dictamen de reportar abre un plazo de 3 días hábiles para presentar el reporte en el SITI.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.porReportar.map((pendiente) => (
              <li key={pendiente.casoId}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/pld/casos/${pendiente.casoId}#reporte-titulo`}>{pendiente.razonSocial ?? "Aviso sin empresa"}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>{PROPUESTA[pendiente.resultado]}</span>
                      <span>
                        Vence {pendiente.reporteVenceEn ? fechaHora(pendiente.reporteVenceEn) : pendiente.reporteVenceEl ? `el ${fechaDia(pendiente.reporteVenceEl)}` : "sin plazo"}
                      </span>
                    </p>
                  </div>
                  <Insignia tono={pendiente.vencido || (pendiente.diasHabiles ?? 3) <= 1 ? "aviso" : "neutro"}>
                    {pendiente.reporteVenceEn ? (pendiente.vencido ? "Fuera de plazo" : "Reporte de 24 horas") : plazoEnDiasHabiles(pendiente.diasHabiles ?? 0, pendiente.vencido)}
                  </Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <Hoja id="pld-periodicos-titulo" titulo="Reportes periódicos">
        {bandeja.faltaClaveEntidad || bandeja.faltaCalendario ? (
          <div className="operacion-ficha-cabeza">
            {bandeja.faltaClaveEntidad ? <Insignia tono="aviso">Falta la clave de la entidad</Insignia> : null}
            {bandeja.faltaCalendario ? <Insignia tono="aviso">Falta el calendario {bandeja.faltaCalendario}</Insignia> : null}
          </div>
        ) : null}
        {periodicos.length === 0 ? (
          <Vacio titulo="Al corriente">Los reportes del trimestre y del mes ya tienen su envío registrado.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {periodicos.map((periodico) => (
              <li key={`${periodico.reporte}-${periodico.periodo}`}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/reportes#reporte-${periodico.reporte}-${periodico.periodo}`}>{periodico.nombre}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>Vence el {fechaDia(periodico.vence)}</span>
                    </p>
                  </div>
                  <Insignia tono={periodico.estado === "vencido" ? "aviso" : "neutro"}>{plazoEnDiasHabiles(periodico.diasHabiles, periodico.estado === "vencido")}</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <Hoja id="pld-evaluaciones-titulo" titulo="Evaluaciones semestrales">
        {bandeja.propuestasDePerfil.length > 0 ? (
          <ul className="operacion-lista">
            {bandeja.propuestasDePerfil.map((propuesta) => (
              <li key={propuesta.propuestaId}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/clientes/${propuesta.companyId}/expediente#perfil-titulo`}>{propuesta.razonSocial}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>Originación propuso cambiar el perfil transaccional el {fechaHora(propuesta.propuestaEn)}</span>
                    </p>
                  </div>
                  <Insignia tono="aviso">Por resolver</Insignia>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {bandeja.evaluaciones.length === 0 ? (
          <Vacio titulo="Sin evaluaciones pendientes">Cada cliente con seis meses o más desde su contrato se evalúa una vez por semestre.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.evaluaciones.map((pendiente) => (
              <li key={pendiente.companyId}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/clientes/${pendiente.companyId}/expediente#evaluacion-titulo`}>{pendiente.razonSocial}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>Contrato del {fechaDia(pendiente.celebracion)}</span>
                      <span>{pendiente.ultimaEvaluacion ? `Última evaluación ${fechaDia(pendiente.ultimaEvaluacion)}` : "Sin evaluaciones"}</span>
                      {pendiente.anteriorFaltante ? <span>También falta la del semestre anterior</span> : null}
                    </p>
                  </div>
                  <Insignia tono="aviso">Antes del {fechaDia(pendiente.vence)}</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <Hoja id="pld-comite-titulo" titulo="Comité">
        {comite === 0 ? (
          <Vacio titulo="Al corriente">Sin avisos de integración por comunicar{bandeja.modo === "comite" ? " y con la sesión del mes registrada" : ""}.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.modo === "comite" && bandeja.sesionDelMesPendiente ? (
              <li>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href="/operacion/comite#sesiones-titulo">Sesión del mes pendiente</Link>
                    </h3>
                    <p className="operacion-meta">El Comité sesiona al menos una vez al mes.</p>
                  </div>
                  <Insignia tono="aviso">Pendiente</Insignia>
                </div>
              </li>
            ) : null}
            {bandeja.mesesSinSesion.map((mes) => (
              <li key={`sin-sesion-${mes}`}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href="/operacion/comite#sesiones-titulo">Sin sesión con quórum en {nombreDelMes(`${mes}-01`).toLocaleLowerCase("es-MX")}</Link>
                    </h3>
                    <p className="operacion-meta">Ese mes el Comité no sesionó con la mayoría de sus miembros.</p>
                  </div>
                  <Insignia tono="aviso">Sin sesión</Insignia>
                </div>
              </li>
            ))}
            {bandeja.comunicacionesComite.map((pendiente) => (
              <li key={`${pendiente.tipo}-${pendiente.integranteId}`}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href="/operacion/comite#comunicaciones-titulo">
                        {pendiente.tipo === "designacion" ? "Designación" : "Baja"} de {pendiente.nombre}
                      </Link>
                    </h3>
                    <p className="operacion-meta">Comunicar en el SITI a más tardar el {fechaDia(pendiente.vence)}.</p>
                  </div>
                  <Insignia tono="neutro">Por comunicar</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>
    </>
  );
}
