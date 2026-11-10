import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { abrirCasoAccion } from "@/app/operacion/(portal)/pld/acciones";
import { idDeAncla } from "@/components/operacion/envio-sin-script";
import { fechaDia, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { plazoEnDias, resumenDeAlerta } from "@/components/operacion/pld/formato";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, Hoja, Insignia, Metrica, Metricas, Monto, NotaRegla, Vacio } from "@/components/sistema";
import { PROPUESTA, REGLA } from "@/dominio/pld";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, leerBandejaPld } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alertas PLD · Operación" };

/**
 * Alertas de PLD (54ª) por analizar y casos abiertos. Confidenciales (55ª): solo
 * Cumplimiento y Auditoría; Auditoría consulta sin botones. Los días que quedan se
 * cuentan al leer con la fecha de hoy en la Ciudad de México (40ª: 60 días naturales).
 */
export default async function AlertasPld({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  if (!puedeEnOperacion(ctx, "plataforma.pld.ver")) {
    return (
      <PaginaOperacion titulo="Alertas PLD">
        <SinPermiso>Las alertas de PLD son confidenciales: las ven Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const ahora = ahoraPld();
  const bandeja = await leerBandejaPld(ctx, { ahora });
  const analiza = puedeEnOperacion(ctx, "plataforma.pld.analizar");
  const fuera = bandeja.alertasSinCaso.filter((alerta) => alerta.fueraDePlazo).length + bandeja.casosAbiertos.filter((caso) => caso.fueraDePlazo).length;
  // B5: destinos de enlaces con fragmento (bandeja y Comité). En la respuesta a un envío sin JavaScript llevan sufijo
  // (idDeAncla del #59): el fragmento de la dirección ya no coincide y el foco llega al campo rechazado.
  const anclaAlertas = await idDeAncla("alertas-titulo");

  return (
    <PaginaOperacion
      titulo="Alertas PLD"
      aviso={params.aviso}
      accion={
        <Link className="boton-texto" href="/operacion/pld/parametros">
          Parámetros de las reglas
        </Link>
      }
    >
      <Metricas etiqueta="Alertas PLD">
        <Metrica rotulo="Por analizar" nota="Alertas sin caso">
          <Monto>{bandeja.alertasSinCaso.length}</Monto>
        </Metrica>
        <Metrica rotulo="Casos abiertos" nota={bandeja.modo === "oficial" ? "Dictamina el Oficial de Cumplimiento" : "Dictamina el Comité"}>
          <Monto>{bandeja.casosAbiertos.length}</Monto>
        </Metrica>
        <Metrica rotulo="Fuera de plazo" nota="Pasaron 60 días sin dictamen">
          <Monto>{fuera}</Monto>
        </Metrica>
      </Metricas>

      <Hoja id={anclaAlertas} titulo="Alertas por analizar">
        {bandeja.alertasSinCaso.length === 0 ? (
          <Vacio titulo="Sin alertas por analizar">Cuando una regla o un aviso del personal genere una alerta, aparece aquí con sus días.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.alertasSinCaso.map((alerta) => (
              <li key={alerta.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      {REGLA[alerta.regla].titulo}
                      {alerta.razonSocial ? ` · ${alerta.razonSocial}` : ""}
                    </h3>
                    <p>{resumenDeAlerta(alerta)}</p>
                    <p className="operacion-meta">
                      <span>Generada {fechaHora(alerta.creadaEn)}</span>
                      <span>Vence el {fechaDia(alerta.venceEl)}</span>
                      <span>{alerta.disposicion}</span>
                    </p>
                  </div>
                  <Insignia tono={alerta.fueraDePlazo || alerta.diasRestantes <= 10 ? "aviso" : "neutro"}>{plazoEnDias(alerta.diasRestantes)}</Insignia>
                  {analiza ? (
                    <form action={abrirCasoAccion}>
                      <input type="hidden" name="alertaId" value={alerta.id} />
                      <input type="hidden" name="formId" value={randomUUID()} />
                      <BotonEnviar>Abrir caso</BotonEnviar>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <Hoja id="casos-titulo" titulo="Casos abiertos">
        {bandeja.casosAbiertos.length === 0 ? (
          <Vacio titulo="Sin casos abiertos">Al abrir el caso de una alerta, queda aquí hasta su dictamen.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {bandeja.casosAbiertos.map((caso) => (
              <li key={caso.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>
                      <Link href={`/operacion/pld/casos/${caso.id}`}>{caso.razonSocial ?? "Aviso sin empresa"}</Link>
                    </h3>
                    <p className="operacion-meta">
                      <span>
                        {caso.alertas} {caso.alertas === 1 ? "alerta" : "alertas"}
                      </span>
                      <span>{caso.propuesta ? `Propuesta: ${PROPUESTA[caso.propuesta]}` : "Sin propuesta"}</span>
                      {caso.venceEn ? <span>Reporte de 24 horas · vence {fechaHora(caso.venceEn)}</span> : caso.venceEl ? <span>Vence el {fechaDia(caso.venceEl)}</span> : null}
                    </p>
                  </div>
                  <Insignia tono={caso.fueraDePlazo ? "aviso" : "neutro"}>
                    {caso.venceEn ? (caso.fueraDePlazo ? "Fuera de plazo" : "24 horas") : caso.diasRestantes !== null ? plazoEnDias(caso.diasRestantes) : "Sin plazo"}
                  </Insignia>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <NotaRegla>
        Las alertas no detienen ningún pago ni lote y la empresa nunca se entera de ellas. Lever no transmite reportes a la UIF ni a la CNBV.
      </NotaRegla>
    </PaginaOperacion>
  );
}
