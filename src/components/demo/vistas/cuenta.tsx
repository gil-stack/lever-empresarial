import { IconoCopiar, IconoDescargar, IconoInternacional, IconoInversion, IconoMas } from "@/components/cromo/iconos";
import type { CuentaDemo } from "@/dominio/demo/cuenta";

import { Accion, pesos } from "../piezas";

const ICONOS = [<IconoMas key="mas" />, null, null, <IconoInternacional key="int" />, <IconoInversion key="inv" />, <IconoDescargar key="des" />];

/** plat-07: el saldo de la cuenta, la CLABE para fondear y sus movimientos. */
export function VistaCuenta({ datos }: { datos: CuentaDemo }) {
  return (
    <>
      <div className="demo-rejilla demo-g21">
        <section aria-labelledby="cuenta-saldo">
          <p className="eyebrow" id="cuenta-saldo">
            Saldo de la cuenta de {datos.titular}
          </p>
          <p className="demo-saldo">{pesos(datos.saldoCentavos)}</p>
          <p className="demo-tenue">{datos.enTarjetas}</p>
          <div className="demo-acciones">
            {datos.acciones.map((accion, i) => (
              <Accion key={accion.etiqueta} accion={accion} chico={false} icono={ICONOS[i]} />
            ))}
          </div>
        </section>
        <section className="hoja" aria-labelledby="cuenta-clabe">
          <p className="eyebrow" id="cuenta-clabe">
            CLABE para fondear
          </p>
          <p className="demo-clabe">{datos.clabe}</p>
          <p className="demo-tenue">{datos.clabeNota}</p>
          <div className="demo-acciones">
            <Accion accion={{ etiqueta: "Copiar CLABE", tipo: "secundaria" }} icono={<IconoCopiar />} />
          </div>
        </section>
      </div>
      <h2 className="demo-titulo-seccion">Movimientos de la cuenta</h2>
      <section className="hoja" aria-label="Movimientos de la cuenta">
        <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de movimientos de la cuenta">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Concepto</th>
                <th scope="col">Detalle</th>
                <th scope="col" className="derecha">
                  Monto
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.movimientos.map((movimiento) => (
                <tr key={`${movimiento.fecha}-${movimiento.hora}`}>
                  <td className="demo-num">
                    {movimiento.fecha}
                    <small>{movimiento.hora}</small>
                  </td>
                  <td>
                    <b>{movimiento.concepto}</b>
                  </td>
                  <td className="demo-tenue">{movimiento.detalle}</td>
                  <td className={movimiento.centavos > 0 ? "derecha demo-positivo" : "derecha"}>{pesos(movimiento.centavos, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
