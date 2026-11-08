import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  agregarNotaAccion,
  cargarDocumentoPldAccion,
  dictaminarCasoAccion,
  marcarVeinticuatroHorasAccion,
  registrarPropuestaAccion,
  registrarReportePldAccion,
  sumarAlertaAccion,
} from "@/app/operacion/(portal)/pld/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { CampoArchivo } from "@/components/operacion/campo-archivo";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { ConfirmarParaDecidir } from "@/components/operacion/pld/confirmar";
import { ahoraEnMexicoParaCampo, plazoEnDias, resumenDeAlerta } from "@/components/operacion/pld/formato";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { TOPE_ARCHIVO_TEXTO } from "@/dominio/archivos";
import { PROPUESTA, PROPUESTAS, REGLA, TIPO_AVISO, type TipoAviso } from "@/dominio/pld";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, leerCaso, leerModoDictamen, sesionesQueAprobaron } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Caso PLD · Operación" };

/**
 * Un caso de análisis (40ª, 41ª): sus alertas (una serie del mismo cliente va en un
 * solo reporte), el análisis por escrito, la propuesta, el dictamen y el acuse del
 * SITI. Abrirlo deja el evento «pld_caso_consultado». La persona excluida de un
 * aviso no lo encuentra (60ª). Auditoría lo consulta sin botones.
 */
export default async function CasoPld({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string; en?: string }>;
}) {
  const ctx = await exigirContextoOperacion();
  const [{ id }, busqueda] = await Promise.all([params, searchParams]);
  if (!puedeEnOperacion(ctx, "plataforma.pld.ver")) {
    return (
      <PaginaOperacion titulo="Caso PLD">
        <SinPermiso>Los casos de PLD son confidenciales: los ven Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const ahora = ahoraPld();
  const caso = await leerCaso(ctx, id, { ahora });
  if (!caso) notFound();
  const analiza = puedeEnOperacion(ctx, "plataforma.pld.analizar");
  const dictamina = puedeEnOperacion(ctx, "plataforma.pld.dictaminar");
  const reporta = puedeEnOperacion(ctx, "plataforma.pld.reportar");
  const modo = await leerModoDictamen(ctx);
  const vigente = caso.propuestas[0] ?? null;
  const sesiones = modo.modo === "comite" && vigente && !caso.dictamen ? await sesionesQueAprobaron(ctx, vigente.id) : [];
  const abierto = caso.dictamen === null;
  const error = (seccion: string, campo: string) => (busqueda.en === seccion ? errorDelCampo(busqueda.aviso, campo) : {});
  const titulo = `Caso · ${caso.razonSocial ?? "aviso sin empresa"}`;

  return (
    <PaginaOperacion
      titulo={titulo}
      aviso={busqueda.aviso}
      accion={
        <Link className="boton-texto" href="/operacion/pld">
          ← Alertas PLD
        </Link>
      }
    >
      <div className="operacion-ficha-cabeza">
        <EtiquetaMono nombre="Caso">{caso.id.slice(0, 8).toUpperCase()}</EtiquetaMono>
        {caso.marca24h ? <Insignia tono="aviso">Reporte de 24 horas</Insignia> : null}
        <Insignia tono={caso.fueraDePlazo ? "aviso" : "neutro"}>
          {caso.dictamen
            ? caso.dictamen.fueraDePlazo
              ? "Dictaminado fuera de plazo"
              : "Dictaminado"
            : caso.venceEn
              ? `Vence ${fechaHora(caso.venceEn)}`
              : caso.diasRestantes !== null
                ? plazoEnDias(caso.diasRestantes)
                : "Sin plazo"}
        </Insignia>
        <p className="pista">Abierto por {caso.abiertoPor} · {fechaHora(caso.abiertoEn)}</p>
      </div>

      <Hoja id="alertas-titulo" titulo="Alertas del caso">
        <ul className="operacion-lista">
          {caso.alertas.map((alerta) => (
            <li key={alerta.id}>
              <div className="operacion-fila">
                <div className="operacion-fila-cuerpo">
                  <h3>{REGLA[alerta.regla].titulo}</h3>
                  <p>{resumenDeAlerta(alerta)}</p>
                  <p className="operacion-meta">
                    <span>Generada {fechaHora(alerta.creadaEn)}</span>
                    <span>Vence el {fechaDia(alerta.venceEl)}</span>
                    <span>{alerta.disposicion}</span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="pista">El plazo de 60 días corre desde la alerta más antigua de la serie.</p>
        {abierto && analiza && caso.sumables.length > 0 ? (
          <>
            <h3>Otras alertas sin caso de la misma empresa</h3>
            <ul className="operacion-lista">
              {caso.sumables.map((alerta) => (
                <li key={alerta.id}>
                  <div className="operacion-fila">
                    <div className="operacion-fila-cuerpo">
                      <h4>{REGLA[alerta.regla].titulo}</h4>
                      <p>{resumenDeAlerta(alerta)}</p>
                    </div>
                    <form action={sumarAlertaAccion}>
                      <input type="hidden" name="casoId" value={caso.id} />
                      <input type="hidden" name="alertaId" value={alerta.id} />
                      <BotonEnviar>Sumar a este caso</BotonEnviar>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Hoja>

      {caso.avisos.length > 0 ? (
        <Hoja id="avisos-titulo" titulo="Avisos del personal">
          <ul className="operacion-lista">
            {caso.avisos.map((aviso) => (
              <li key={aviso.id}>
                <div className="operacion-fila-cuerpo">
                  <h3>{TIPO_AVISO[aviso.tipo as TipoAviso] ?? aviso.tipo}</h3>
                  <p className="operacion-meta">
                    <span>Recibido {fechaHora(aviso.recibidoEn)}</span>
                    <span>Folio {aviso.id.slice(0, 8).toUpperCase()}</span>
                  </p>
                  <p className="operacion-sin-corte">{aviso.descripcion}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="pista">Quien avisó no ve este caso. Las personas que marcó tampoco.</p>
        </Hoja>
      ) : null}

      <Hoja id="plazo-titulo" titulo="Plazo">
        {caso.marca24h ? (
          <Renglones>
            <Renglon etiqueta="Marcado como de 24 horas">
              {caso.marca24h.marcadaPor} · {fechaHora(caso.marca24h.marcadaEn)}
            </Renglon>
            <Renglon etiqueta="Motivo">{caso.marca24h.motivo}</Renglon>
            {caso.venceEn ? <Renglon etiqueta="El reporte vence">{fechaHora(caso.venceEn)}</Renglon> : null}
          </Renglones>
        ) : (
          <>
            <p>
              {caso.venceEl ? `El dictamen vence el ${fechaDia(caso.venceEl)}: 60 días naturales desde la alerta más antigua.` : "Sin plazo calculado."}
            </p>
            {abierto && analiza ? (
              <form action={marcarVeinticuatroHorasAccion} className="operacion-forma">
                <input type="hidden" name="casoId" value={caso.id} />
                <div className="campo">
                  <label htmlFor="plazo-motivo">Si hay información de que los recursos pueden venir de actividades ilícitas: qué se sabe</label>
                  <textarea id="plazo-motivo" name="motivo" required minLength={10} maxLength={1000} {...error("plazo-titulo", "motivo")} />
                </div>
                <div className="acciones">
                  <BotonEnviar>Marcar como reporte de 24 horas</BotonEnviar>
                  <p>Desde esta marca, el reporte vence en 24 horas y lleva la leyenda «Reporte de 24 horas».</p>
                </div>
              </form>
            ) : null}
          </>
        )}
      </Hoja>

      <Hoja id="notas-titulo" titulo="Análisis">
        {caso.notas.length === 0 ? (
          <Vacio titulo="Sin notas">Lo que se revise del caso queda por escrito aquí; las notas no se editan ni se borran.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {caso.notas.map((nota) => (
              <li key={nota.id}>
                <div className="operacion-fila-cuerpo">
                  <p className="operacion-sin-corte">{nota.texto}</p>
                  <p className="operacion-meta">
                    <span>{nota.autor}</span>
                    <span>{fechaHora(nota.en)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {analiza ? (
          <form action={agregarNotaAccion} className="operacion-forma">
            <input type="hidden" name="casoId" value={caso.id} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="nota-texto">Nota</label>
              <textarea id="nota-texto" name="texto" required maxLength={4000} {...error("notas-titulo", "texto")} />
            </div>
            <div className="acciones">
              <BotonEnviar>Agregar nota</BotonEnviar>
            </div>
          </form>
        ) : null}
      </Hoja>

      <Hoja id="documentos-titulo" titulo="Documentos de soporte">
        {caso.documentos.length === 0 ? (
          <Vacio titulo="Sin documentos">Estados de cuenta, facturas o lo que respalde el análisis. Se guardan con su huella y no se borran.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {caso.documentos.map((documento) => (
              <li key={documento.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <a href={`/operacion/pld/casos/${caso.id}/documento/${documento.id}`}>{documento.nombre}</a>
                    </h3>
                    <p className="operacion-meta">
                      <span>{documento.autor}</span>
                      <span>{fechaHora(documento.en)}</span>
                      <span>{(documento.tamano / 1024).toLocaleString("es-MX", { maximumFractionDigits: 0 })} KB</span>
                    </p>
                  </div>
                  <EtiquetaMono nombre="SHA-256">{documento.sha256.slice(0, 16)}…</EtiquetaMono>
                </div>
              </li>
            ))}
          </ul>
        )}
        {analiza ? (
          <form action={cargarDocumentoPldAccion} className="operacion-forma">
            <input type="hidden" name="casoId" value={caso.id} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="documento-archivo">Archivo PDF, JPG o PNG, hasta {TOPE_ARCHIVO_TEXTO}</label>
              <CampoArchivo
                id="documento-archivo"
                name="archivo"
                accept="application/pdf,image/jpeg,image/png"
                mensaje={`El archivo pasa de ${TOPE_ARCHIVO_TEXTO}. Sube uno más ligero.`}
                required
                ligado={error("documentos-titulo", "archivo")}
              />
            </div>
            <div className="acciones">
              <BotonEnviar>Subir documento</BotonEnviar>
              <p>Cada descarga queda en la bitácora.</p>
            </div>
          </form>
        ) : null}
      </Hoja>

      <Hoja id="propuesta-titulo" titulo="Propuesta">
        {caso.propuestas.length === 0 ? (
          <Vacio titulo="Sin propuesta">Cumplimiento propone reportar o no reportar, con su justificación.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {caso.propuestas.map((propuesta, indice) => (
              <li key={propuesta.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>{PROPUESTA[propuesta.propuesta]}</h3>
                    <p className="operacion-sin-corte">{propuesta.justificacion}</p>
                    <p className="operacion-meta">
                      <span>{propuesta.autor}</span>
                      <span>{fechaHora(propuesta.en)}</span>
                    </p>
                  </div>
                  <Insignia tono={indice === 0 ? "sello" : "neutro"}>{indice === 0 ? "Vigente" : "Anterior"}</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
        {abierto && analiza ? (
          <form action={registrarPropuestaAccion} className="operacion-forma">
            <input type="hidden" name="casoId" value={caso.id} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="propuesta-propuesta">Propuesta</label>
              <select id="propuesta-propuesta" name="propuesta" required defaultValue="" {...error("propuesta-titulo", "propuesta")}>
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
              <textarea id="propuesta-justificacion" name="justificacion" required minLength={10} maxLength={4000} {...error("propuesta-titulo", "motivo")} />
            </div>
            <div className="acciones">
              <BotonEnviar>Registrar propuesta</BotonEnviar>
              <p>{modo.modo === "comite" ? "El Comité vota la propuesta vigente en una sesión." : "El Oficial de Cumplimiento dictamina con su justificación."}</p>
            </div>
          </form>
        ) : null}
      </Hoja>

      <Hoja id="dictamen-titulo" titulo="Dictamen">
        {dictamina && abierto ? <ConfirmarParaDecidir motivo="Antes de registrar el dictamen, prueba tu segundo factor. Vale 30 minutos." /> : null}
        {caso.dictamen ? (
          <Renglones>
            <Renglon etiqueta="Resultado">{PROPUESTA[caso.dictamen.resultado]}</Renglon>
            <Renglon etiqueta="Vía">{caso.dictamen.via === "comite" ? "Comité de Comunicación y Control" : "Oficial de Cumplimiento"}</Renglon>
            <Renglon etiqueta="Fecha del dictamen">{fechaDia(caso.dictamen.dictaminadoEl)}</Renglon>
            <Renglon etiqueta="Plazo">{caso.dictamen.fueraDePlazo ? "Fuera de plazo" : "A tiempo"}</Renglon>
            <Renglon etiqueta="Justificación">{caso.dictamen.justificacion}</Renglon>
            <Renglon etiqueta="Registró">{caso.dictamen.autor}</Renglon>
          </Renglones>
        ) : !dictamina ? (
          <Vacio titulo="Sin dictamen">Lo registra Cumplimiento.</Vacio>
        ) : modo.modo === "oficial" ? (
          ctx.persona.id === modo.oficialId ? (
            <form action={dictaminarCasoAccion} className="operacion-forma">
              <input type="hidden" name="casoId" value={caso.id} />
              <input type="hidden" name="formId" value={randomUUID()} />
              <input type="hidden" name="via" value="oficial" />
              <div className="campo">
                <label htmlFor="dictamen-resultado">Resultado</label>
                <select id="dictamen-resultado" name="resultado" required defaultValue={vigente?.propuesta ?? ""} {...error("dictamen-titulo", "resultado")}>
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
              <div className="campo">
                <label htmlFor="dictamen-justificacion">Justificación</label>
                <textarea id="dictamen-justificacion" name="justificacion" required minLength={10} maxLength={4000} {...error("dictamen-titulo", "motivo")} />
              </div>
              <div className="acciones">
                <BotonEnviar>Registrar dictamen</BotonEnviar>
                <p>{caso.fueraDePlazo ? "Pasaron los 60 días: se registra igual, marcado «fuera de plazo»." : "Exige tu segundo factor de los últimos 30 minutos."}</p>
              </div>
            </form>
          ) : (
            <Vacio titulo="Dictamina el Oficial de Cumplimiento">{modo.oficial ? `${modo.oficial} registra el dictamen de este caso.` : "Falta designar al Oficial en Comité."}</Vacio>
          )
        ) : !vigente ? (
          <Vacio titulo="Falta la propuesta">El Comité vota la propuesta vigente del caso.</Vacio>
        ) : sesiones.length === 0 ? (
          <Vacio titulo="Sin votación aprobada">
            La propuesta vigente se vota en una sesión del Comité con quórum. <Link href="/operacion/comite#sesiones-titulo">Ir a Comité</Link>
          </Vacio>
        ) : (
          <form action={dictaminarCasoAccion} className="operacion-forma">
            <input type="hidden" name="casoId" value={caso.id} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <input type="hidden" name="via" value="comite" />
            <input type="hidden" name="propuestaId" value={vigente.id} />
            <input type="hidden" name="resultado" value="" />
            <p>
              Resultado: <strong>{PROPUESTA[vigente.propuesta]}</strong>, como lo aprobó el Comité. La fecha del dictamen es la de la sesión.
            </p>
            <div className="campo">
              <label htmlFor="dictamen-sesion">Sesión</label>
              <select id="dictamen-sesion" name="sesionId" required defaultValue={sesiones[0]!.id} {...error("dictamen-titulo", "sesionId")}>
                {sesiones.map((sesion) => (
                  <option key={sesion.id} value={sesion.id}>
                    Sesión del {fechaDia(sesion.celebradaEl)}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="dictamen-justificacion">Justificación</label>
              <textarea id="dictamen-justificacion" name="justificacion" required minLength={10} maxLength={4000} {...error("dictamen-titulo", "motivo")} />
            </div>
            <div className="acciones">
              <BotonEnviar>Registrar dictamen</BotonEnviar>
              <p>{caso.fueraDePlazo ? "Pasaron los 60 días: se registra igual, marcado «fuera de plazo»." : "Exige tu segundo factor de los últimos 30 minutos."}</p>
            </div>
          </form>
        )}
      </Hoja>

      {caso.dictamen && caso.dictamen.resultado !== "no_reportar" ? (
        <Hoja id="reporte-titulo" titulo="Reporte al SITI">
          <Renglones>
            <Renglon etiqueta="Tipo">{caso.dictamen.resultado === "reportar_inusual" ? "2 · Operación inusual" : "3 · Operación interna preocupante"}</Renglon>
            <Renglon etiqueta="Vence">
              {caso.dictamen.reporteVenceEn ? fechaHora(caso.dictamen.reporteVenceEn) : caso.dictamen.reporteVenceEl ? `${fechaDia(caso.dictamen.reporteVenceEl)} (3 días hábiles)` : "Sin plazo"}
            </Renglon>
          </Renglones>
          <p>
            <a className="boton-texto" href={`/operacion/pld/casos/${caso.id}/reporte`}>
              Descargar el borrador con el layout de 41 columnas
            </a>
          </p>
          <p className="pista">Borrador según el layout del DOF. El Oficial completa las columnas con los catálogos de la CNBV y lo presenta en el SITI.</p>
          {caso.reporte ? (
            <Renglones>
              <Renglon etiqueta="Folio del acuse">{caso.reporte.folio}</Renglon>
              <Renglon etiqueta="Tipo de reporte">{caso.reporte.tipoReporte}</Renglon>
              <Renglon etiqueta="Periodo">{caso.reporte.periodo}</Renglon>
              <Renglon etiqueta="Recibido">{fechaHora(caso.reporte.recibidoEn)}</Renglon>
              <Renglon etiqueta="Registros">{caso.reporte.registros}</Renglon>
              <Renglon etiqueta="Plazo">{caso.reporte.fueraDePlazo ? "Fuera de plazo" : "A tiempo"}</Renglon>
            </Renglones>
          ) : reporta ? (
            <form action={registrarReportePldAccion} className="formulario-pareja operacion-forma">
              <input type="hidden" name="casoId" value={caso.id} />
              <input type="hidden" name="formId" value={randomUUID()} />
              <div className="campo">
                <label htmlFor="reporte-folio">Folio del acuse</label>
                <input id="reporte-folio" name="folio" required maxLength={40} autoComplete="off" {...error("reporte-titulo", "folio")} />
              </div>
              <div className="campo">
                <label htmlFor="reporte-periodo">Periodo (AAAAMMDD)</label>
                <input id="reporte-periodo" name="periodo" required inputMode="numeric" pattern="[0-9]{8}" defaultValue={caso.dictamen.dictaminadoEl.replace(/-/g, "")} {...error("reporte-titulo", "periodo")} />
              </div>
              <div className="campo">
                <label htmlFor="reporte-recibido">Fecha y hora de recepción (Ciudad de México)</label>
                <input id="reporte-recibido" name="recibidoEn" type="datetime-local" required min={`${caso.dictamen.dictaminadoEl}T00:00`} max={ahoraEnMexicoParaCampo(new Date())} {...error("reporte-titulo", "recibidoEn")} />
              </div>
              <div className="campo">
                <label htmlFor="reporte-registros">Número de registros</label>
                <input id="reporte-registros" name="registros" required inputMode="numeric" defaultValue="1" {...error("reporte-titulo", "registros")} />
              </div>
              <div className="acciones operacion-ancho">
                <BotonEnviar>Registrar acuse</BotonEnviar>
                <p>El acuse no se puede modificar después, igual que en el SITI.</p>
              </div>
            </form>
          ) : (
            <Vacio titulo="Sin acuse">Lo registra Cumplimiento cuando el Oficial presenta el reporte.</Vacio>
          )}
        </Hoja>
      ) : null}

      <NotaRegla>Lever no transmite reportes a la UIF ni a la CNBV: registra lo que el Oficial presentó en el SITI. Nada de este caso se borra.</NotaRegla>
    </PaginaOperacion>
  );
}
