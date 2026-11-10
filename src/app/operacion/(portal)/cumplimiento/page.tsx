import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { Coincidencias } from "@/components/operacion/coincidencias";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { BandejaDePld } from "@/components/operacion/pld/bandeja";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { Hoja, Insignia, Metrica, Metricas, Monto, NotaRegla, Vacio } from "@/components/sistema";
import { ETIQUETA_GRADO } from "@/dominio/operacion";
import { exigirContextoOperacion, leerBandejaCumplimiento, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, leerBandejaPld } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Cumplimiento · Operación" };

/**
 * La bandeja de Cumplimiento: coincidencias por revisar con su plazo de 24 horas (75ª),
 * versiones del expediente por dictaminar, revisiones de riesgo vencidas (27ª) y expedientes
 * aprobados sin grado de riesgo. «Vencida» se calcula al leer con la fecha de hoy en México.
 * Auditoría la consulta sin botones.
 */
export default async function CumplimientoOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  if (!puedeEnOperacion(ctx, "plataforma.cumplimiento.bandeja")) {
    return (
      <PaginaOperacion titulo="Cumplimiento">
        <SinPermiso>La bandeja de Cumplimiento la ven Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const ahora = new Date();
  const [bandeja, params] = await Promise.all([leerBandejaCumplimiento(ctx, { ahora }), soloTexto(searchParams)]);
  const resuelve = puedeEnOperacion(ctx, "plataforma.lpb.resolver");
  const vencidas = bandeja.revisiones.filter((revision) => revision.vencida);
  const urgentes = bandeja.coincidencias.filter((coincidencia) => coincidencia.estado === "confirmada");
  // Ola R2: lo de PLD, con el «hoy» del reloj de PLD (fijo solo en las pruebas).
  const pld = puedeEnOperacion(ctx, "plataforma.pld.ver") ? await leerBandejaPld(ctx, { ahora: ahoraPld() }) : null;
  return (
    <PaginaOperacion titulo="Cumplimiento" aviso={params.aviso}>
      <Metricas etiqueta="Bandeja de Cumplimiento">
        <Metrica rotulo="Coincidencias" nota={`${urgentes.length} por reportar en 24 horas`}>
          <Monto>{bandeja.coincidencias.length}</Monto>
        </Metrica>
        <Metrica rotulo="Por dictaminar" nota="Versiones enviadas sin dictamen">
          <Monto>{bandeja.porDictaminar.length}</Monto>
        </Metrica>
        <Metrica rotulo="Revisiones vencidas" nota={`${bandeja.sinCalificar.length} sin grado de riesgo`}>
          <Monto>{vencidas.length}</Monto>
        </Metrica>
      </Metricas>
      <Hoja id="coincidencias-titulo" titulo="Coincidencias con listas">
        <Coincidencias
          coincidencias={bandeja.coincidencias}
          resuelve={resuelve}
          desde="cumplimiento"
          ahora={ahora}
          vacio="Cuando una carga de la lista o un alta coincida con alguien, aparece aquí."
        />
      </Hoja>
      <Hoja id="dictaminar-titulo" titulo="Expedientes por dictaminar">
        {bandeja.porDictaminar.length === 0 ? (
          <Vacio titulo="Nada por dictaminar">Las versiones que envíe Originación aparecen aquí.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.porDictaminar.map((version) => (
              <li key={version.versionId}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/clientes/${version.companyId}/expediente#dictamen-titulo`}>{version.razonSocial}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>Versión {version.numero}</span>
                      <span>
                        Envió {version.enviadaPor} · {fechaHora(version.enviadaEn)}
                      </span>
                    </p>
                  </div>
                  <Insignia>Por dictaminar</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>
      <Hoja id="revisiones-titulo" titulo="Grado de riesgo">
        {bandeja.revisiones.length === 0 && bandeja.sinCalificar.length === 0 ? (
          <Vacio titulo="Sin calificaciones">El grado de riesgo se registra al aprobar el expediente.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.sinCalificar.map((empresa) => (
              <li key={`sin-${empresa.companyId}`}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/clientes/${empresa.companyId}/expediente#riesgo-titulo`}>{empresa.razonSocial}</Link>
                    </h3>
                    <p className="operacion-meta">Versión {empresa.numero} sin grado de riesgo.</p>
                  </div>
                  <Insignia tono="aviso">Sin calificar</Insignia>
                </div>
              </li>
            ))}
            {bandeja.revisiones.map((revision) => (
              <li key={revision.companyId}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/clientes/${revision.companyId}/expediente#riesgo-titulo`}>{revision.razonSocial}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>Grado {ETIQUETA_GRADO[revision.grado].toLowerCase()}</span>
                      <span>Revisar antes del {fechaDia(revision.revisarAntesDe)}</span>
                    </p>
                  </div>
                  <Insignia tono={revision.vencida ? "aviso" : "neutro"}>{revision.vencida ? "Revisión vencida" : "Vigente"}</Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>
      {pld ? <BandejaDePld bandeja={pld} /> : null}
      <NotaRegla>
        Lever no transmite reportes a la UIF: registra la coincidencia, el plazo de 24 horas, quién la atendió y el folio que
        Cumplimiento presentó por su propia vía.
      </NotaRegla>
    </PaginaOperacion>
  );
}
