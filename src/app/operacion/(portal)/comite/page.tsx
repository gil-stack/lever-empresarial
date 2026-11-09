import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import {
  registrarAuditorAccion,
  registrarComunicacionAccion,
  registrarSesionAccion,
} from "@/app/operacion/(portal)/pld/acciones";
import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { errorDelCampo } from "@/components/operacion/aviso";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { ConfirmarParaDecidir } from "@/components/operacion/pld/confirmar";
import { FormularioIntegrantes } from "@/components/operacion/pld/formulario-integrantes";
import { FormularioModo } from "@/components/operacion/pld/formularios-de-texto";
import { ahoraEnMexicoParaCampo } from "@/components/operacion/pld/formato";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { nombreDelMes } from "@/dominio/flujo/fechas";
import { hoyEnMexico } from "@/dominio/operacion/comisiones";
import { CARGO_COMITE } from "@/dominio/pld";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, contenidoParaSiti, leerComite, leerModoDictamen, nombreDeIntegrante, personalDeCumplimiento } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Comité · Operación" };

const RENGLONES = 5;

/**
 * Quién dictamina (47ª, último párrafo), los integrantes del Comité de Comunicación
 * y Control con los 14 campos del aviso de la 49ª, el auditor (voz sin voto), los
 * avisos de integración por comunicar en 15 días hábiles y las sesiones (47ª, 48ª).
 * Lo administra Cumplimiento; Auditoría lo consulta.
 */
export default async function ComiteOperacion({ searchParams }: { searchParams: Parametros<"aviso" | "en"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  if (!puedeEnOperacion(ctx, "plataforma.pld.ver")) {
    return (
      <PaginaOperacion titulo="Comité">
        <SinPermiso>El Comité de Comunicación y Control lo administra Cumplimiento y lo consulta Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const ahora = ahoraPld();
  const hoy = hoyEnMexico(ahora);
  const [comite, modo, deCumplimiento] = await Promise.all([leerComite(ctx, { ahora }), leerModoDictamen(ctx), personalDeCumplimiento(ctx)]);
  const administra = puedeEnOperacion(ctx, "plataforma.pld.comite");
  const error = (seccion: string, campo: string) => (params.en === seccion ? errorDelCampo(params.aviso, campo) : {});
  const sinPresentes: { "aria-invalid"?: true; "aria-describedby"?: string; autoFocus?: true } = error("sesiones-titulo", "presentes");
  const vigentes = comite.integrantes.filter((integrante) => integrante.vigente);
  const titulares = vigentes.filter((integrante) => integrante.titularidad === "TITULAR");
  const anteriores = comite.integrantes.filter((integrante) => !integrante.vigente);
  const porId = new Map(comite.integrantes.map((integrante) => [integrante.id, integrante]));
  const pendientesDeDesignacion = comite.pendientes.filter((p) => p.tipo === "designacion");
  const pendientesDeBaja = comite.pendientes.filter((p) => p.tipo === "baja");
  const paraSiti = comite.pendientes.map((p) => porId.get(p.integranteId)).filter((i): i is NonNullable<typeof i> => i !== undefined);
  const ids = Array.from({ length: RENGLONES }, () => randomUUID());

  return (
    <PaginaOperacion titulo="Comité" aviso={params.aviso}>
      <Hoja id="modo-titulo" titulo="Quién dictamina">
        <div className="operacion-ficha-cabeza">
          <Insignia tono="sello">{modo.modo === "comite" ? "Comité de Comunicación y Control" : `Oficial de Cumplimiento: ${modo.oficial ?? "sin designar"}`}</Insignia>
        </div>
        <p className="pista">
          Con menos de 25 personas al servicio de la SOFIPO no hay Comité obligatorio y sus funciones las ejerce el Oficial de Cumplimiento. En ese modo no
          hay sesiones: el Oficial dictamina cada caso con justificación y corren los mismos plazos.
        </p>
        {administra ? <ConfirmarParaDecidir motivo="Antes de cambiar quién dictamina, prueba tu segundo factor. Vale 30 minutos." /> : null}
        {administra ? (
          <FormularioModo formId={randomUUID()} modo={modo.modo} oficialId={modo.oficialId ?? ""} personas={deCumplimiento} />
        ) : null}
      </Hoja>

      <Hoja id="integrantes-titulo" titulo="Integrantes">
        {vigentes.length === 0 ? (
          <Vacio titulo="Sin integrantes">Registra la integración completa: al menos tres titulares, un presidente, un secretario y al Oficial de Cumplimiento.</Vacio>
        ) : (
          <div className="operacion-tabla" role="region" aria-label="Integrantes vigentes" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Cargo</th>
                  <th scope="col">Área y cargo en la entidad</th>
                  <th scope="col">RFC · CURP</th>
                  <th scope="col">Designado</th>
                </tr>
              </thead>
              <tbody>
                {vigentes.map((integrante) => (
                  <tr key={integrante.id}>
                    <td>
                      {nombreDeIntegrante(integrante)}
                      {integrante.esOficial ? <Insignia tono="sello">Oficial</Insignia> : null}
                    </td>
                    <td data-rotulo="Cargo">
                      {CARGO_COMITE[integrante.cargo]} · {integrante.titularidad === "TITULAR" ? "titular" : `suplente de ${porId.get(integrante.suplenteDe ?? "") ? nombreDeIntegrante(porId.get(integrante.suplenteDe!)!) : "su titular"}`}
                    </td>
                    <td data-rotulo="Área y cargo en la entidad">
                      {integrante.area} · {integrante.cargoEntidad}
                    </td>
                    <td data-rotulo="RFC · CURP" className="operacion-mono">
                      {integrante.rfc} · {integrante.curp}
                    </td>
                    <td data-rotulo="Designado">{fechaDia(integrante.designadoEl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {anteriores.length > 0 ? (
          <details className="operacion-detalle">
            <summary>Integrantes anteriores ({anteriores.length})</summary>
            <ul className="operacion-lista">
              {anteriores.map((integrante) => (
                <li key={integrante.id}>
                  {nombreDeIntegrante(integrante)} · {CARGO_COMITE[integrante.cargo]} · sustituido el {integrante.sustituidoEl ? fechaDia(integrante.sustituidoEl) : "—"}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {administra ? (
          <FormularioIntegrantes
            ids={ids}
            hoy={hoy}
            titulares={titulares.map((titular) => ({ id: titular.id, etiqueta: `${nombreDeIntegrante(titular)} (${CARGO_COMITE[titular.cargo]})` }))}
            vigentes={vigentes.map((integrante) => ({
              id: integrante.id,
              etiqueta: `${nombreDeIntegrante(integrante)} (${CARGO_COMITE[integrante.cargo]}, ${integrante.titularidad === "TITULAR" ? "titular" : "suplente"})`,
            }))}
          />
        ) : null}
      </Hoja>

      <Hoja id="auditor-titulo" titulo="Auditor interno">
        {comite.auditor ? (
          <Renglones>
            <Renglon etiqueta="Nombre">{comite.auditor.nombre}</Renglon>
            <Renglon etiqueta="Cargo">{comite.auditor.cargoEntidad}</Renglon>
            <Renglon etiqueta="Designado">{fechaDia(comite.auditor.designadoEl)}</Renglon>
          </Renglones>
        ) : (
          <Vacio titulo="Sin auditor registrado">Asiste a las sesiones con voz y sin voto; no es integrante ni cuenta para el quórum.</Vacio>
        )}
        {administra ? (
          <form action={registrarAuditorAccion} className="formulario-pareja operacion-forma">
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="auditor-nombre">Nombre</label>
              <input id="auditor-nombre" name="nombre" required maxLength={200} autoComplete="off" {...error("auditor-titulo", "nombre")} />
            </div>
            <div className="campo">
              <label htmlFor="auditor-cargo">Cargo en la entidad</label>
              <input id="auditor-cargo" name="cargoEntidad" required maxLength={120} autoComplete="off" {...error("auditor-titulo", "cargoEntidad")} />
            </div>
            <div className="campo">
              <label htmlFor="auditor-rfc">RFC con homoclave</label>
              <input id="auditor-rfc" name="rfc" required maxLength={13} autoComplete="off" className="operacion-mono" {...error("auditor-titulo", "rfc")} />
            </div>
            <div className="campo">
              <label htmlFor="auditor-curp">CURP</label>
              <input id="auditor-curp" name="curp" required maxLength={18} autoComplete="off" className="operacion-mono" {...error("auditor-titulo", "curp")} />
            </div>
            <div className="campo">
              <label htmlFor="auditor-designado">Fecha de designación</label>
              <input id="auditor-designado" name="designadoEl" type="date" required max={hoy} defaultValue={hoy} {...error("auditor-titulo", "designadoEl")} />
            </div>
            <div className="acciones operacion-ancho">
              <BotonEnviar>{comite.auditor ? "Registrar otro auditor" : "Registrar auditor"}</BotonEnviar>
            </div>
          </form>
        ) : null}
      </Hoja>

      <Hoja id="comunicaciones-titulo" titulo="Avisos de integración al SITI">
        {comite.pendientes.length === 0 ? (
          <Vacio titulo="Nada por comunicar">Cada designación, adición o sustitución se comunica en el SITI dentro de 15 días hábiles.</Vacio>
        ) : (
          <>
            <ul className="operacion-lista">
              {comite.pendientes.map((pendiente) => (
                <li key={`${pendiente.tipo}-${pendiente.integranteId}`}>
                  <div className="operacion-fila">
                    <div className="operacion-fila-cuerpo">
                      <h3>{pendiente.nombre}</h3>
                      <p className="operacion-meta">
                        <span>{pendiente.tipo === "designacion" ? "Designación" : "Baja"} del {fechaDia(pendiente.desde)}</span>
                        <span>Comunicar a más tardar el {fechaDia(pendiente.vence)}</span>
                      </p>
                    </div>
                    <Insignia tono={pendiente.vence < hoy ? "aviso" : "neutro"}>{pendiente.vence < hoy ? "Vencido" : "Por comunicar"}</Insignia>
                  </div>
                </li>
              ))}
            </ul>
            <h3>Lo que el Oficial captura en el SITI</h3>
            {/* r2-serv-N11: desplazable a 390 px; con el teclado también (Tab llega, las flechas lo recorren). */}
            <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Contenido para el SITI">
              <pre className="operacion-mono">{contenidoParaSiti(paraSiti)}</pre>
            </div>
            <p className="pista">Los 14 campos del instructivo de la CNBV, en el orden del layout. Lever no lo transmite.</p>
          </>
        )}
        {administra && comite.pendientes.length > 0 ? (
          <form action={registrarComunicacionAccion} className="formulario-pareja operacion-forma">
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="comunicacion-folio">Folio del acuse del SITI</label>
              <input id="comunicacion-folio" name="folio" required maxLength={40} autoComplete="off" {...error("comunicaciones-titulo", "folio")} />
            </div>
            <div className="campo">
              <label htmlFor="comunicacion-recibido">Fecha y hora de recepción</label>
              <input id="comunicacion-recibido" name="recibidoEn" type="datetime-local" required max={ahoraEnMexicoParaCampo(new Date())} {...error("comunicaciones-titulo", "recibidoEn")} />
            </div>
            <fieldset className="opciones operacion-ancho">
              <legend>Qué cubre</legend>
              {pendientesDeDesignacion.map((p) => (
                <label key={`d-${p.integranteId}`} className="confirmacion">
                  <input type="checkbox" name="integrantes" value={p.integranteId} defaultChecked />
                  <span>Designación de {p.nombre}</span>
                </label>
              ))}
              {pendientesDeBaja.map((p) => (
                <label key={`b-${p.integranteId}`} className="confirmacion">
                  <input type="checkbox" name="bajas" value={p.integranteId} defaultChecked />
                  <span>Baja de {p.nombre}</span>
                </label>
              ))}
            </fieldset>
            <div className="acciones operacion-ancho">
              <BotonEnviar>Registrar comunicación</BotonEnviar>
            </div>
          </form>
        ) : null}
        {comite.comunicaciones.length > 0 ? (
          <details className="operacion-detalle">
            <summary>Comunicaciones registradas ({comite.comunicaciones.length})</summary>
            <ul className="operacion-lista">
              {comite.comunicaciones.map((c) => (
                <li key={c.id}>
                  <EtiquetaMono nombre="Folio">{c.folio}</EtiquetaMono> · {fechaHora(c.recibidoEn)} · {c.integrantes} designaciones y {c.bajas} bajas
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Hoja>

      <Hoja id="sesiones-titulo" titulo="Sesiones">
        {/* r2-serv-N13 (61ª): en modo Oficial no se registran sesiones nuevas, pero el historial y sus actas siguen a la vista. */}
        {modo.modo === "oficial" ? (
          <p className="pista">Dictamina el Oficial de Cumplimiento: no se registran sesiones nuevas. Las anteriores y sus actas quedan para consulta.</p>
        ) : (
          <>
            <div className="operacion-ficha-cabeza">
              <Insignia tono={comite.sesionDelMes ? "sello" : "aviso"}>{comite.sesionDelMes ? "Sesión del mes registrada" : "Sesión del mes pendiente"}</Insignia>
              <p className="pista">El Comité sesiona al menos una vez al mes, con la mayoría de sus miembros.</p>
            </div>
            {comite.mesesSinSesion.length > 0 ? (
              <p>
                <Insignia tono="aviso">Sin sesión con quórum</Insignia> {comite.mesesSinSesion.map((mes) => nombreDelMes(`${mes}-01`)).join(", ")}.
              </p>
            ) : null}
            {comite.avisosSuplentes.length > 0 ? (
              <ul className="operacion-lista">
                {comite.avisosSuplentes.map((aviso) => (
                  <li key={aviso.integranteId}>
                    <Insignia tono="aviso">Suplente</Insignia> {aviso.nombre}: {aviso.seguidas ? "asistió a dos sesiones seguidas" : `asistió a ${aviso.sesiones} sesiones en el semestre`}.
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {comite.sesiones.length === 0 ? (
          <Vacio titulo="Sin sesiones registradas">
            {modo.modo === "oficial" ? "El Comité no registró sesiones." : "Registra cada sesión con su fecha y quiénes estuvieron presentes."}
          </Vacio>
        ) : (
          <ul className="operacion-lista">
            {comite.sesiones.map((sesion) => (
              <li key={sesion.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/comite/sesiones/${sesion.id}`}>Sesión del {fechaDia(sesion.celebradaEl)}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>
                        {sesion.representados} de {sesion.miembros} miembros
                      </span>
                      <span>{sesion.acta ? "Acta firmada cargada" : "Sin acta firmada"}</span>
                    </p>
                  </div>
                  <Insignia tono={sesion.quorum ? "sello" : "aviso"}>{sesion.quorum ? "Con quórum" : "Sin quórum"}</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
        {modo.modo === "comite" && administra && vigentes.length > 0 ? (
          <form action={registrarSesionAccion} className="formulario-pareja operacion-forma">
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="sesion-fecha">Fecha de la sesión</label>
              <input id="sesion-fecha" name="celebradaEl" type="date" required max={hoy} defaultValue={hoy} {...error("sesiones-titulo", "celebradaEl")} />
            </div>
            {/* r2-serv-N6: el fieldset no recibe el foco; con el aviso, lo toma la primera casilla. */}
            <fieldset className="opciones operacion-ancho" aria-invalid={sinPresentes["aria-invalid"]} aria-describedby={sinPresentes["aria-describedby"]}>
              <legend>Presentes</legend>
              {vigentes.map((integrante, indice) => (
                <label key={integrante.id} className="confirmacion">
                  <input type="checkbox" name="presentes" value={integrante.id} autoFocus={indice === 0 && sinPresentes.autoFocus === true} />
                  <span>
                    {nombreDeIntegrante(integrante)} · {CARGO_COMITE[integrante.cargo]}
                    {integrante.titularidad === "SUPLENTE" ? " (suplente)" : ""}
                  </span>
                </label>
              ))}
              {comite.auditor ? (
                <label className="confirmacion">
                  <input type="checkbox" name="auditorPresente" value="si" />
                  <span>{comite.auditor.nombre} · auditor, con voz y sin voto</span>
                </label>
              ) : null}
            </fieldset>
            <div className="acciones operacion-ancho">
              <BotonEnviar>Registrar sesión</BotonEnviar>
              <p>Sin la mayoría de los miembros, queda registrada «sin quórum» y no admite votos.</p>
            </div>
          </form>
        ) : null}
      </Hoja>

      <NotaRegla>El auditor interno participa con voz y sin voto: no es integrante, no cuenta para el quórum y no se comunica en el aviso de la 49ª.</NotaRegla>
    </PaginaOperacion>
  );
}
