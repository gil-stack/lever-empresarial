import Link from "next/link";

import { Insignia, Metrica, Metricas, Monto, NotaRegla, Vacio } from "@/components/sistema";
import { fechaLarga } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";
import type { LecturaNomina } from "@/server/nomina/tipos";

import { BotonPrepararNomina } from "./boton-preparar";
import { NavegacionPersonas } from "./navegacion";
import { dinero } from "./util";

export function PantallaNomina({
  lectura,
  hoy,
  empresaId,
  puedePreparar,
}: {
  lectura: LecturaNomina;
  hoy: string;
  empresaId: string;
  puedePreparar: boolean;
}) {
  // Los totales salen de SQL sobre toda la programación; la tabla puede venir recortada.
  const { totales } = lectura;
  return (
    <>
      <h1 className="solo-lector">Nómina programada</h1>
      <Metricas etiqueta="Resumen de nómina">
        <Metrica rotulo="Próxima fecha"><Monto>{totales.proximaFecha ? fechaCorta(totales.proximaFecha) : "—"}</Monto></Metrica>
        <Metrica rotulo="Neto de esa fecha" nota={totales.proximaFecha ? fechaLarga(totales.proximaFecha) : "Sin programación"}>
          <Monto>{totales.proximaFecha ? dinero(totales.netoProximaCentavos) : "—"}</Monto>
        </Metrica>
        <Metrica rotulo="Lotes preparados"><Monto>{totales.lotes}</Monto></Metrica>
        <Metrica rotulo="Destinos por revisar" nota={totales.destinosPendientes ? "CLABE o tarjeta por completar" : "Todo al día"}>
          <Monto>{totales.destinosPendientes}</Monto>
        </Metrica>
      </Metricas>
      <NavegacionPersonas actual="nomina" empresaId={empresaId} />

      <div className="nomina-rejilla">
        <section className="panel" aria-labelledby="proxima-nomina">
          <div className="panel-cabeza">
            <h2 id="proxima-nomina">Próximos pagos</h2>
            {puedePreparar ? <BotonPrepararNomina empresaId={empresaId} fechaPago={totales.primeraVencida} /> : <small>Tu rol consulta la programación; no prepara lotes.</small>}
          </div>
          {!lectura.detalle ? (
            <p className="lede">
              {totales.programadas} {totales.programadas === 1 ? "pago programado" : "pagos programados"}. Tu rol ve los totales; el neto de cada persona lo ve quien prepara o autoriza la nómina.
            </p>
          ) : lectura.proximas.length === 0 ? <Vacio titulo="No hay nómina programada">Configura neto, frecuencia y primer pago en cada expediente.</Vacio> : (
            <>
              {lectura.proximas.length < totales.programadas ? (
                <p className="pista">Se muestran los primeros {lectura.proximas.length} de {totales.programadas} pagos programados. Los totales cuentan todos.</p>
              ) : null}
              <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de la nómina programada">
                <table className="tabla personas-tabla nomina-tabla">
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Colaborador</th><th scope="col">Área</th><th scope="col" className="derecha">Neto</th><th scope="col">Destino</th></tr></thead>
                  <tbody>
                    {lectura.proximas.map((persona) => (
                      <tr key={persona.personaId}>
                        <td data-label="Fecha">{fechaLarga(persona.fechaPago)}{persona.fechaPago <= hoy ? <Insignia tono="aviso">Vencida</Insignia> : null}</td>
                        <td data-label="Colaborador"><Link className="persona-enlace" href={enEmpresa(empresaId, `/consola/personas/${persona.personaId}`)}>{persona.nombre}</Link></td>
                        <td data-label="Área">{persona.areaNombre}</td>
                        <td className="cifra" data-label="Neto">{dinero(persona.netoCentavos)}</td>
                        <td data-label="Destino">{persona.destino === "clabe" ? "CLABE externa" : "Tarjeta"}<small>{persona.destinoListo ? "Destino listo" : "Destino pendiente"}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="lotes-nomina">
          <div className="panel-cabeza">
            <h2 id="lotes-nomina">Lotes para revisión</h2>
            <small>{totales.lotes} {totales.lotes === 1 ? "lote" : "lotes"}</small>
          </div>
          {lectura.lotes.length === 0 ? <Vacio titulo="Todavía no hay lotes preparados">Cuando una fecha venza, quien tenga permiso podrá prepararla.</Vacio> : (
            <div className="lotes-lista">
              {lectura.lotes.map((lote) => (
                <Link key={lote.id} className="lote-renglon" href={enEmpresa(empresaId, `/consola/personas/nomina/${lote.id}`)}>
                  <span><strong>{fechaLarga(lote.fechaPago)}</strong><small>{lote.personas} {lote.personas === 1 ? "persona" : "personas"}</small></span>
                  <span><strong>{dinero(lote.totalCentavos)}</strong><small>{lote.destinosPendientes ? `${lote.destinosPendientes} destinos pendientes` : "Destinos listos"}</small></span>
                  <Insignia tono={lote.destinosPendientes ? "aviso" : "sello"}>Preparada</Insignia>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <NotaRegla>Preparar congela importes y destinos en un lote para revisión. La dispersión de la nómina todavía no sale desde Lever.</NotaRegla>
    </>
  );
}

const FECHA_CORTA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });

/** «31 oct» para la cifra grande; la fecha completa va en la nota. */
function fechaCorta(iso: string): string {
  return FECHA_CORTA.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
}
