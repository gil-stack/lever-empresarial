import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { cargarActaAccion, registrarVotoAccion } from "@/app/operacion/(portal)/pld/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { CampoArchivo } from "@/components/operacion/campo-archivo";
import { fechaDia } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { TOPE_ARCHIVO_TEXTO } from "@/dominio/archivos";
import { CARGO_COMITE, PROPUESTA, type Propuesta } from "@/dominio/pld";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, leerComite, leerVotaciones, nombreDeIntegrante, propuestasPorVotar } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Sesión del Comité · Operación" };

/**
 * Una sesión del Comité (47ª, 48ª): quórum con la mayoría de los miembros, el voto
 * de cada integrante presente sobre la propuesta vigente de cada caso, el resultado
 * (mayoría de los presentes; en empate decide el presidente), el acta que genera
 * Lever y la firmada que sube Cumplimiento. Sin quórum no admite votos.
 */
export default async function SesionComite({
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
      <PaginaOperacion titulo="Sesión del Comité">
        <SinPermiso>Las sesiones del Comité las ven Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const [comite, votaciones, porVotar] = await Promise.all([leerComite(ctx, { ahora: ahoraPld() }), leerVotaciones(ctx, id), propuestasPorVotar(ctx)]);
  const sesion = comite.sesiones.find((s) => s.id === id);
  if (!sesion) notFound();
  const administra = puedeEnOperacion(ctx, "plataforma.pld.comite");
  const error = (seccion: string, campo: string) => (busqueda.en === seccion ? errorDelCampo(busqueda.aviso, campo) : {});
  const porId = new Map(comite.integrantes.map((integrante) => [integrante.id, integrante]));
  const presentes = sesion.presentes.map((presente) => porId.get(presente)).filter((i): i is NonNullable<typeof i> => i !== undefined);
  const presidente = sesion.presidenteId ? porId.get(sesion.presidenteId) : undefined;
  // Las votaciones de esta sesión más las propuestas vigentes que aún no se votan aquí y que ya
  // existían el día de la sesión (la base rechaza votar una posterior).
  const votadas = new Set(votaciones.map((v) => v.propuestaId));
  const temas: Array<{ casoId: string; propuestaId: string; propuesta: Propuesta; razonSocial: string | null; abierta: boolean }> = [
    ...votaciones.map((v) => {
      const pendiente = porVotar.find((p) => p.propuestaId === v.propuestaId);
      return { casoId: v.casoId, propuestaId: v.propuestaId, propuesta: v.propuesta, razonSocial: pendiente?.razonSocial ?? null, abierta: pendiente !== undefined };
    }),
    ...porVotar.filter((p) => !votadas.has(p.propuestaId) && p.registradaEl <= sesion.celebradaEl).map((p) => ({ ...p, abierta: true })),
  ];

  return (
    <PaginaOperacion
      titulo={`Sesión del ${fechaDia(sesion.celebradaEl)}`}
      aviso={busqueda.aviso}
      accion={
        <Link className="boton-texto" href="/operacion/comite#sesiones-titulo">
          ← Comité
        </Link>
      }
    >
      <Hoja id="quorum-titulo" titulo="Quórum">
        <div className="operacion-ficha-cabeza">
          <Insignia tono={sesion.quorum ? "sello" : "aviso"}>{sesion.quorum ? "Con quórum" : "Sin quórum: no admite votos"}</Insignia>
        </div>
        <Renglones>
          <Renglon etiqueta="Miembros presentes o representados">
            {sesion.representados} de {sesion.miembros} (se requiere la mayoría)
          </Renglon>
          <Renglon etiqueta="Preside">{presidente ? nombreDeIntegrante(presidente) : "Sin presidente presente"}</Renglon>
          <Renglon etiqueta="Presentes">
            {presentes.map((integrante) => `${nombreDeIntegrante(integrante)} (${CARGO_COMITE[integrante.cargo]}${integrante.titularidad === "SUPLENTE" ? ", suplente" : ""})`).join(", ")}
          </Renglon>
          <Renglon etiqueta="Auditor interno">{sesion.auditorPresente ? "Asistió, con voz y sin voto" : "No asistió"}</Renglon>
        </Renglones>
      </Hoja>

      <Hoja id="votaciones-titulo" titulo="Votaciones">
        {!sesion.quorum ? (
          <Vacio titulo="Sin votaciones">Sin la mayoría de los miembros la sesión no es válida para votar.</Vacio>
        ) : temas.length === 0 ? (
          <Vacio titulo="Nada por votar">Cuando un caso tenga propuesta, aparece aquí para que los presentes la voten.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {temas.map((tema) => {
              const votacion = votaciones.find((v) => v.propuestaId === tema.propuestaId);
              const votos = new Map((votacion?.votos ?? []).map((v) => [v.integranteId, v.voto]));
              return (
                <li key={tema.propuestaId}>
                  <div className="operacion-fila">
                    <div className="operacion-fila-cuerpo">
                      <h3>
                        <Link href={`/operacion/pld/casos/${tema.casoId}`}>{tema.razonSocial ?? "Caso"}</Link>: {PROPUESTA[tema.propuesta]}
                      </h3>
                    </div>
                    <Insignia tono={votacion?.resultado === "aprobada" ? "sello" : votacion?.resultado === "rechazada" ? "aviso" : "neutro"}>
                      {votacion?.resultado === "aprobada" ? "Aprobada" : votacion?.resultado === "rechazada" ? "Rechazada" : "Sin mayoría todavía"}
                    </Insignia>
                  </div>
                  <ul className="operacion-lista">
                    {presentes.map((integrante) => {
                      const voto = votos.get(integrante.id);
                      const titularPresente = integrante.titularidad === "SUPLENTE" && integrante.suplenteDe !== null && sesion.presentes.includes(integrante.suplenteDe);
                      return (
                        <li key={integrante.id}>
                          <div className="operacion-fila">
                            <div className="operacion-fila-cuerpo">
                              <p>
                                {nombreDeIntegrante(integrante)} · {CARGO_COMITE[integrante.cargo]}
                                {integrante.id === sesion.presidenteId ? " · preside, voto de calidad en empate" : ""}
                              </p>
                            </div>
                            {voto ? (
                              <Insignia tono={voto === "a_favor" ? "sello" : "aviso"}>{voto === "a_favor" ? "A favor" : "En contra"}</Insignia>
                            ) : titularPresente ? (
                              <p className="pista">Su titular está presente: no vota.</p>
                            ) : administra && tema.abierta ? (
                              <form action={registrarVotoAccion} className="operacion-decision-botones">
                                <input type="hidden" name="sesionId" value={sesion.id} />
                                <input type="hidden" name="propuestaId" value={tema.propuestaId} />
                                <input type="hidden" name="integranteId" value={integrante.id} />
                                <input type="hidden" name="formId" value={randomUUID()} />
                                <BotonEnviar name="voto" value="a_favor" aria-label={`${nombreDeIntegrante(integrante)} vota a favor`}>
                                  A favor
                                </BotonEnviar>
                                <BotonEnviar name="voto" value="en_contra" className="boton-secundario" aria-label={`${nombreDeIntegrante(integrante)} vota en contra`}>
                                  En contra
                                </BotonEnviar>
                              </form>
                            ) : (
                              <p className="pista">Sin voto</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </Hoja>

      <Hoja id="acta-titulo" titulo="Acta">
        <p>
          <a className="boton-texto" href={`/operacion/comite/sesiones/${sesion.id}/acta`}>
            Descargar el acta en PDF para firmar
          </a>
        </p>
        <p className="pista">La firman el presidente y el secretario. Después se sube aquí la firmada.</p>
        {sesion.acta ? (
          <Renglones>
            <Renglon etiqueta="Acta firmada">
              <a href={`/operacion/comite/actas/${sesion.acta.id}`}>{sesion.acta.nombre}</a>
            </Renglon>
            <Renglon etiqueta="Huella SHA-256">
              <EtiquetaMono nombre="SHA-256">{sesion.acta.sha256}</EtiquetaMono>
            </Renglon>
          </Renglones>
        ) : administra ? (
          <form action={cargarActaAccion} className="operacion-forma">
            <input type="hidden" name="sesionId" value={sesion.id} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="campo">
              <label htmlFor="acta-archivo">Acta firmada: PDF, JPG o PNG, hasta {TOPE_ARCHIVO_TEXTO}</label>
              <CampoArchivo
                id="acta-archivo"
                name="archivo"
                accept="application/pdf,image/jpeg,image/png"
                mensaje={`El archivo pasa de ${TOPE_ARCHIVO_TEXTO}. Sube uno más ligero.`}
                required
                ligado={error("acta-titulo", "archivo")}
              />
            </div>
            <div className="acciones">
              <BotonEnviar>Subir acta firmada</BotonEnviar>
            </div>
          </form>
        ) : (
          <Vacio titulo="Sin acta firmada">La sube Cumplimiento.</Vacio>
        )}
      </Hoja>

      <NotaRegla>Decide la mayoría de los miembros presentes; en empate, el voto del presidente. El suplente vota solo cuando falta su titular.</NotaRegla>
    </PaginaOperacion>
  );
}
