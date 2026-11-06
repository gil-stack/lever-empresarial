import Link from "next/link";

import { CabezaPagina, Hoja, Insignia, Metrica, Metricas, Vacio } from "@/components/sistema";
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
      <CabezaPagina kicker="Personas" titulo="Nómina programada">
        <p className="lede">Próximos netos, fechas y lotes preparados para revisión.</p>
        {puedePreparar ? <div className="acciones"><BotonPrepararNomina empresaId={empresaId} fechaPago={totales.primeraVencida} /></div> : <p className="regla-fija">Tu rol consulta la programación. No prepara lotes ni dispersa dinero.</p>}
      </CabezaPagina>
      <NavegacionPersonas actual="nomina" empresaId={empresaId} />
      <Metricas etiqueta="Resumen de nómina">
        <Metrica rotulo="Próxima fecha">{totales.proximaFecha ? fechaLarga(totales.proximaFecha) : "Sin programación"}</Metrica>
        <Metrica rotulo="Neto de esa fecha">{totales.proximaFecha ? dinero(totales.netoProximaCentavos) : "—"}</Metrica>
        <Metrica rotulo="Lotes preparados">{totales.lotes}</Metrica>
        <Metrica rotulo="Destinos por revisar">{totales.destinosPendientes}</Metrica>
      </Metricas>
      <p className="nota-regla">Preparar congela un lote administrativo. No emite tarjetas, no autoriza una dispersión y no mueve dinero.</p>

      <Hoja id="proxima-nomina" titulo="Próximos pagos">
        {!lectura.detalle ? (
          <p className="lede">
            {totales.programadas} {totales.programadas === 1 ? "pago programado" : "pagos programados"}. Tu rol ve los totales; el neto de cada persona lo ve quien prepara o autoriza la nómina.
          </p>
        ) : lectura.proximas.length === 0 ? <Vacio titulo="No hay nómina programada">Configura neto, frecuencia y primer pago en cada expediente.</Vacio> : (
          <>
            {lectura.proximas.length < totales.programadas ? (
              <p className="pista">Se muestran los primeros {lectura.proximas.length} de {totales.programadas} pagos programados. Los totales cuentan todos.</p>
            ) : null}
            <div className="personas-tabla-envoltura">
              <table className="personas-tabla nomina-tabla">
                <thead><tr><th scope="col">Fecha</th><th scope="col">Colaborador</th><th scope="col">Área</th><th scope="col">Neto</th><th scope="col">Destino</th></tr></thead>
                <tbody>
                  {lectura.proximas.map((persona) => (
                    <tr key={persona.personaId}>
                      <td data-label="Fecha">{fechaLarga(persona.fechaPago)}{persona.fechaPago <= hoy ? <Insignia tono="aviso">Vencida</Insignia> : null}</td>
                      <td data-label="Colaborador"><Link className="persona-enlace" href={enEmpresa(empresaId, `/consola/personas/${persona.personaId}`)}>{persona.nombre}</Link></td>
                      <td data-label="Área">{persona.areaNombre}</td>
                      <td className="numero" data-label="Neto">{dinero(persona.netoCentavos)}</td>
                      <td data-label="Destino">{persona.destino === "clabe" ? "CLABE externa" : "Tarjeta"}<span className="persona-celda-nota">{persona.destinoListo ? "Destino listo" : "Destino pendiente"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Hoja>

      <Hoja id="lotes-nomina" titulo="Lotes para revisión">
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
      </Hoja>
    </>
  );
}
