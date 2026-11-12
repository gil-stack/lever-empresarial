import Link from "next/link";

import { AvisosDeLista } from "@/components/flujo/formularios";
import { Estado, pesos, Tarjeta } from "@/components/demo/piezas";
import { formatoPesos } from "@/dominio/centavos";
import {
  ETIQUETA_ESTADO_OPERACION,
  conceptoSeguro,
  importeMovimiento,
  ETIQUETA_ESTADO_TARJETA,
  ETIQUETA_TIPO_OPERACION,
  minutosParaConciliar,
  operable,
  terminacionSegura,
  TONO_ESTADO_TARJETA,
} from "@/dominio/tarjetas/vista";
import { enEmpresa } from "@/nucleo/rutas";
import type { DetalleTarjeta } from "@/server/tarjetas";

import { AccionesTarjeta, ResolverOperacion } from "./formularios";

/** El detalle de una tarjeta: estado, saldo, sus movimientos en el emisor y lo que Lever le pidió. */
export function VistaDetalleTarjeta({ detalle, empresaId, puedeOperar, ahora }: { detalle: DetalleTarjeta; empresaId: string | null; puedeOperar: boolean; ahora: Date }) {
  const { tarjeta, movimientos, operaciones } = detalle;
  const terminacion = terminacionSegura(tarjeta.terminacion);
  return (
    <AvisosDeLista>
      <p><Link className="boton-texto" href={enEmpresa(empresaId, "/consola/tarjetas")}>Todas las tarjetas</Link></p>
      <div className="demo-barra-herramientas">
        <h2 className="demo-titulo-seccion">
          {tarjeta.nombre} <span className="demo-mono demo-tenue">••{terminacion}</span>
        </h2>
        <Estado estado={{ texto: ETIQUETA_ESTADO_TARJETA[tarjeta.estado], tono: TONO_ESTADO_TARJETA[tarjeta.estado] }} />
        <span className="demo-empuje" />
        {puedeOperar && operable(tarjeta) ? (
          <AccionesTarjeta id={tarjeta.id} terminacion={terminacion} estado={tarjeta.estado} saldoTarjetaCentavos={tarjeta.saldoCentavos} saldoEmpresaCentavos={detalle.saldoEmpresa.tipo === "listo" ? detalle.saldoEmpresa.centavos : null} />
        ) : null}
      </div>
      <dl className="demo-cifras" aria-label="La tarjeta">
        <div className="demo-cifra"><dt className="eyebrow">Saldo</dt><dd className="demo-cifra-valor">{tarjeta.saldoCentavos === null ? "—" : pesos(tarjeta.saldoCentavos)}</dd></div>
        <div className="demo-cifra"><dt className="eyebrow">Titular</dt><dd className="demo-cifra-valor">{tarjeta.titular ?? "Sin titular"}</dd></div>
      </dl>
      <Tarjeta id="tarjeta-movimientos" titulo="Movimientos en el emisor">
        {movimientos === null ? (
          <p className="demo-tenue">El emisor no respondió los movimientos. Recarga en un momento.</p>
        ) : movimientos.length === 0 ? (
          <p className="demo-tenue">Sin movimientos todavía.</p>
        ) : (
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de movimientos de la tarjeta">
            <table className="tabla">
              <thead><tr><th scope="col">Fecha</th><th scope="col">Concepto</th><th scope="col" className="derecha">Importe</th></tr></thead>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={`${m.fecha}-${i}`}><td>{m.fecha}</td><td>{conceptoSeguro(m.concepto)}</td><td className="derecha">{importeMovimiento(m) ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
      <Tarjeta id="tarjeta-operaciones" titulo="Operaciones de Lever">
        {operaciones.length === 0 ? (
          <p className="demo-tenue">Lever todavía no ha operado esta tarjeta.</p>
        ) : (
          <ul className="demo-lista">
            {operaciones.map((op) => (
              <li className="demo-li" key={op.id} data-operacion={op.referencia}>
                <div className="demo-li-texto">
                  <b>{ETIQUETA_TIPO_OPERACION[op.tipo]}{op.montoCentavos === null ? null : ` · ${formatoPesos(op.montoCentavos)}`}</b>
                  <small>
                    {ETIQUETA_ESTADO_OPERACION[op.estado]} · referencia <span className="demo-mono">{op.referencia}</span>
                    {op.codigoEfevoo ? ` · código del emisor ${op.codigoEfevoo}` : null}
                    {op.reintentoDe ? " · reintento" : null}
                  </small>
                </div>
                {puedeOperar && (op.estado === "incierta" || op.buscadaSinEncontrar) ? (
                  <ResolverOperacion id={op.id} referencia={op.referencia} incierta={op.estado === "incierta"} conciliada={op.buscadaSinEncontrar} esperaMin={minutosParaConciliar(op.creadaEn, ahora)} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </AvisosDeLista>
  );
}
