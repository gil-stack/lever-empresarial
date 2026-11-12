import { formatoPesos } from "@/dominio/centavos";
import { conceptoSeguro, ETIQUETA_ESTADO_TARJETA, importeMovimiento, terminacionSegura } from "@/dominio/tarjetas/vista";
import type { TarjetaDelTitular } from "@/server/tarjetas";

/** Las tarjetas del titular: terminación, estado, saldo y sus últimos movimientos. Sin operar: eso lo hace la empresa. */
export function TarjetasTitular({ tarjetas }: { tarjetas: readonly TarjetaDelTitular[] | null }) {
  return (
    <>
      <h1 className="solo-lector">Tus tarjetas</h1>
      {!tarjetas || tarjetas.length === 0 ? (
        <div className="vacio"><p className="vacio-titulo">Sin tarjetas</p><p>Cuando la empresa te asigne una, aparece aquí con su saldo.</p></div>
      ) : (
        <ul className="tarjetas-app">
          {tarjetas.map(({ tarjeta, movimientos }) => (
            <li key={tarjeta.id} data-tarjeta={terminacionSegura(tarjeta.terminacion)}>
              <div className="tarjetas-app-cabeza">
                <p>
                  <b>{tarjeta.nombre} ••{terminacionSegura(tarjeta.terminacion)}</b>
                  <small>{ETIQUETA_ESTADO_TARJETA[tarjeta.estado]}</small>
                </p>
                <p className="tope-monto">{tarjeta.saldoCentavos === null ? "Saldo no disponible" : formatoPesos(tarjeta.saldoCentavos)}</p>
              </div>
              {movimientos === null ? (
                <p className="pista">El emisor no respondió los movimientos. Vuelve a intentar en un momento.</p>
              ) : movimientos.length === 0 ? (
                <p className="pista">Sin movimientos todavía.</p>
              ) : (
                <ul className="movimientos-app" aria-label={`Movimientos de la tarjeta ••${terminacionSegura(tarjeta.terminacion)}`}>
                  {movimientos.map((m, i) => (
                    <li key={`${m.fecha}-${i}`}>
                      <span>{conceptoSeguro(m.concepto)}<small>{m.fecha}</small></span>
                      <span className={m.tipo === "cargo" ? "monto-cargo" : "monto-abono"}>{importeMovimiento(m) ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
