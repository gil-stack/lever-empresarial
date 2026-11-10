import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { crearVersionAccion } from "@/app/operacion/acciones-alta";
import { Coincidencias } from "@/components/operacion/coincidencias";
import { FormulariosBorrador, VistaVersion } from "@/components/operacion/expediente";
import { etiquetaEstado, fechaDia, fechaHora } from "@/components/operacion/formato";
import { FormularioDictamen } from "@/components/operacion/formulario-dictamen";
import { FormularioRiesgo } from "@/components/operacion/formulario-riesgo";
import { idDeAncla } from "@/components/operacion/envio-sin-script";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { PerfilTransaccional } from "@/components/operacion/pld/perfil";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, EtiquetaMono, Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { ETIQUETA_GRADO, ETIQUETA_NIVEL, ETIQUETA_RESULTADO, fraseDeLoQueFalta } from "@/dominio/operacion";
import {
  enRevisionDeCumplimiento,
  exigirContextoOperacion,
  leerExpediente,
  listarCoincidencias,
  puedeEnOperacion,
} from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Expediente · Operación" };

const FACTORES: Record<string, string> = {
  actividad: "Actividad",
  zona: "Zona geográfica",
  antiguedad_meses: "Antigüedad (meses)",
  capas: "Capas de la estructura",
  pep: "Persona expuesta políticamente",
  volumen_mensual_centavos: "Volumen mensual",
  coincidencias: "Coincidencias en listas",
};

function valorFactor(clave: string, valor: string | number): string {
  if (clave === "volumen_mensual_centavos" && typeof valor === "number") return `$${(valor / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
  if (clave === "actividad" || clave === "zona") return ETIQUETA_NIVEL[valor as "baja"] ?? String(valor);
  return String(valor);
}

/**
 * El expediente KYB de una empresa (4ª fr. II de las disposiciones del art. 124 LACP): versiones,
 * la vigente de solo lectura, el borrador que captura Originación, el dictamen de Cumplimiento y
 * el grado de riesgo. Abrir esta página deja el evento «expediente_consultado» en la bitácora.
 */
export default async function ExpedienteCliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Parametros<"aviso" | "faltan">;
}) {
  const ctx = await exigirContextoOperacion();
  const [{ id }, busqueda] = await Promise.all([params, soloTexto(searchParams)]);
  if (!puedeEnOperacion(ctx, "plataforma.expediente.ver")) {
    return (
      <PaginaOperacion titulo="Expediente">
        <SinPermiso>El expediente lo consultan Originación, Aprobación, Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const expediente = await leerExpediente(ctx, id);
  if (!expediente) notFound();
  // El detalle de la lista lo ven Cumplimiento y Auditoría; los demás, solo si hay revisión abierta.
  const veLista = puedeEnOperacion(ctx, "plataforma.cumplimiento.bandeja");
  // Destinos de los enlaces de Cumplimiento (`#dictamen-titulo`, `#riesgo-titulo`): sin JavaScript, la página que responde
  // a un envío los pinta con sufijo para que el fragmento no le quite el foco al campo rechazado (idDeAncla).
  const [anclaDictamen, anclaRiesgo] = await Promise.all([idDeAncla("dictamen-titulo"), idDeAncla("riesgo-titulo")]);
  const [coincidencias, enRevision] = await Promise.all([
    veLista ? listarCoincidencias(ctx, { companyId: id }) : Promise.resolve([]),
    veLista ? Promise.resolve(false) : enRevisionDeCumplimiento(ctx, id),
  ]);
  const captura = puedeEnOperacion(ctx, "plataforma.expediente.capturar");
  const dictamina = puedeEnOperacion(ctx, "plataforma.expediente.dictaminar");
  const califica = puedeEnOperacion(ctx, "plataforma.riesgo.calificar");
  const resuelve = puedeEnOperacion(ctx, "plataforma.lpb.resolver");
  const { vigente, borrador, riesgo } = expediente;
  const esperaDictamen = vigente !== null && vigente.dictamen === null;
  const siguiente = (expediente.versiones[0]?.numero ?? 0) + 1;

  return (
    <PaginaOperacion
      titulo={`Expediente · ${expediente.empresa.razonSocial}`}
      aviso={busqueda.aviso}
      detalleAviso={busqueda.aviso === "expediente_datos_incompletos" ? (fraseDeLoQueFalta((busqueda.faltan ?? "").split(",")) ?? undefined) : undefined}
      accion={
        <Link className="boton-texto" href={`/operacion/clientes/${id}`}>
          ← Ficha
        </Link>
      }
    >
      <div className="operacion-ficha-cabeza">
        <EtiquetaMono nombre="RFC">{expediente.empresa.rfc}</EtiquetaMono>
        <Insignia tono={expediente.empresa.estado === "activa" ? "sello" : expediente.empresa.estado === "suspendida" ? "aviso" : "neutro"}>
          {etiquetaEstado(expediente.empresa.estado)}
        </Insignia>
        {vigente?.dictamen ? (
          <Insignia tono={vigente.dictamen.resultado === "aprobado" ? "sello" : "aviso"}>
            Versión {vigente.numero}: {ETIQUETA_RESULTADO[vigente.dictamen.resultado]}
          </Insignia>
        ) : null}
      </div>

      <Hoja id="versiones-titulo" titulo="Versiones">
        {expediente.versiones.length === 0 ? (
          <Vacio titulo="Sin expediente">Originación abre la primera versión con los datos de la empresa.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {expediente.versiones.map((version) => (
              <li key={version.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>Versión {version.numero}</h3>
                    <p className="operacion-meta">
                      {version.enviadaEn ? <span>Enviada {fechaHora(version.enviadaEn)}</span> : <span>Borrador en captura</span>}
                    </p>
                  </div>
                  <Insignia tono={version.resultado === "aprobado" ? "sello" : version.resultado ? "aviso" : "neutro"}>
                    {version.resultado ? ETIQUETA_RESULTADO[version.resultado] : version.estado === "enviada" ? "Por dictaminar" : "Borrador"}
                  </Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
        {captura && !borrador && !esperaDictamen && expediente.empresa.estado !== "baja" ? (
          <form action={crearVersionAccion}>
            <input type="hidden" name="companyId" value={id} />
            <input type="hidden" name="formId" value={randomUUID()} />
            <div className="acciones">
              <BotonEnviar>Abrir versión {siguiente}</BotonEnviar>
              <p>{vigente ? "Parte de la versión anterior; la anterior no cambia." : "Parte de la razón social y el RFC registrados."}</p>
            </div>
          </form>
        ) : null}
        {esperaDictamen && !borrador ? <p className="pista">La versión {vigente.numero} espera el dictamen de Cumplimiento.</p> : null}
      </Hoja>

      {borrador && captura ? (
        <FormulariosBorrador version={borrador} companyId={id} />
      ) : null}
      {borrador && !captura ? (
        <Hoja id="borrador-titulo" titulo={`Borrador ${borrador.numero}`}>
          <Vacio titulo="En captura">Originación está armando esta versión. Se ve completa cuando la envíe.</Vacio>
        </Hoja>
      ) : null}

      {vigente ? (
        <>
          <Hoja id={anclaDictamen} titulo={`Dictamen · versión ${vigente.numero}`}>
            {vigente.dictamen ? (
              <>
                <Renglones>
                  <Renglon etiqueta="Resultado">{ETIQUETA_RESULTADO[vigente.dictamen.resultado]}</Renglon>
                  <Renglon etiqueta="Dictaminó">
                    {vigente.dictamen.dictaminadoPor} · {fechaHora(vigente.dictamen.dictaminadoEn)}
                  </Renglon>
                  {vigente.dictamen.motivo ? <Renglon etiqueta="Motivo">{vigente.dictamen.motivo}</Renglon> : null}
                </Renglones>
                {vigente.dictamen.resultado === "observado" ? (
                  <p className="pista">Originación corrige en una versión nueva; esta queda como se dictaminó.</p>
                ) : null}
              </>
            ) : dictamina ? (
              <FormularioDictamen
                companyId={id}
                versionId={vigente.id}
                formId={randomUUID()}
                envio={`Envió ${vigente.enviadaPor ?? "Originación"}${vigente.enviadaEn ? ` · ${fechaHora(vigente.enviadaEn)}` : ""}`}
              />
            ) : (
              <Vacio titulo="Por dictaminar">La dictamina Cumplimiento.</Vacio>
            )}
          </Hoja>
          <VistaVersion version={vigente} companyId={id} />
        </>
      ) : null}

      <Hoja id={anclaRiesgo} titulo="Grado de riesgo">
        {riesgo ? (
          <>
            <div className="operacion-ficha-cabeza">
              <Insignia tono={riesgo.grado === "alto" ? "aviso" : "neutro"}>Grado {ETIQUETA_GRADO[riesgo.grado].toLowerCase()}</Insignia>
              <Insignia tono={riesgo.vencida ? "aviso" : "sello"}>
                {riesgo.vencida ? "Revisión vencida" : `Revisar antes del ${fechaDia(riesgo.revisarAntesDe)}`}
              </Insignia>
            </div>
            {/* El desglose lo ven Cumplimiento y Auditoría: los demás reciben del servidor solo el grado y la fecha. */}
            {riesgo.desglose ? (
              <Renglones>
                {Object.entries(riesgo.desglose.factores).map(([clave, factor]) => (
                  <Renglon key={clave} etiqueta={FACTORES[clave] ?? clave}>
                    {`${valorFactor(clave, factor.valor)} · ${factor.puntos} ${factor.puntos === 1 ? "punto" : "puntos"}`}
                  </Renglon>
                ))}
                <Renglon etiqueta="Puntaje">{riesgo.desglose.puntaje}</Renglon>
                <Renglon etiqueta="Calificó">
                  {riesgo.desglose.calificadaPor} · {fechaDia(riesgo.desglose.calificadaEl)} · {riesgo.desglose.tipo === "alta" ? "al alta" : "periódica"}
                </Renglon>
              </Renglones>
            ) : (
              <p className="pista">El desglose de la calificación lo ven Cumplimiento y Auditoría.</p>
            )}
          </>
        ) : (
          <Vacio titulo="Sin grado de riesgo">Cumplimiento lo registra cuando la versión vigente está aprobada.</Vacio>
        )}
        {califica && vigente?.dictamen?.resultado === "aprobado" ? (
          <FormularioRiesgo companyId={id} formId={randomUUID()} periodica={riesgo !== null} />
        ) : null}
      </Hoja>

      <PerfilTransaccional ctx={ctx} companyId={id} estado={expediente.empresa.estado} />

      <Hoja id="coincidencias-titulo" titulo={veLista ? "Coincidencias con listas" : "Revisión de Cumplimiento"}>
        {veLista ? (
          <Coincidencias
            coincidencias={coincidencias}
            resuelve={resuelve}
            desde="lpb"
            ahora={new Date()}
            vacio="Ni la empresa, ni sus representantes, accionistas o propietarios reales, ni sus proveedores aparecen en la lista vigente."
          />
        ) : enRevision ? (
          <div className="operacion-ficha-cabeza">
            <Insignia tono="aviso">En revisión de Cumplimiento</Insignia>
            <p className="pista">El detalle lo ven Cumplimiento y Auditoría.</p>
          </div>
        ) : (
          <Vacio titulo="Sin revisión abierta">Cumplimiento no tiene un caso abierto de esta empresa.</Vacio>
        )}
      </Hoja>

      <NotaRegla>
        Las versiones enviadas, los documentos y los dictámenes no se editan ni se borran: se conservan al menos 10 años.
      </NotaRegla>
    </PaginaOperacion>
  );
}
