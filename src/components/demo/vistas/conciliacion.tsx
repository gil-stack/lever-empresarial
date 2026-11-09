import { IconoAlerta, IconoConciliacion, IconoCorreo, IconoCuenta, IconoMas, IconoSeguridad, IconoTarjetas } from "@/components/cromo/iconos";
import type { ConciliacionDemo } from "@/dominio/demo/conciliacion";

import { Accion, Cifras, Estado, pesos, Renglon, Tarjeta } from "../piezas";

const ICONO_DE_FUENTE = [IconoCuenta, IconoTarjetas, IconoCuenta, IconoCuenta, IconoCorreo, IconoSeguridad];

/** plat-01: lo que no cuadra, las fuentes conectadas y lo conciliado. */
export function VistaConciliacion({ datos }: { datos: ConciliacionDemo }) {
  return (
    <>
      <Cifras cifras={datos.cifras} etiqueta="Conciliación de octubre" />
      <div className="demo-rejilla demo-g21">
        <Tarjeta id="conciliacion-revisar" titulo="Por revisar" nota="Lever empata todo lo demás solo">
          <ul className="demo-lista">
            {datos.porRevisar.map((excepcion) => (
              <Renglon
                key={excepcion.titulo}
                icono={<IconoAlerta />}
                tono={excepcion.grave ? "peligro" : "aviso"}
                titulo={excepcion.titulo}
                detalle={excepcion.detalle}
              >
                <div className="demo-li-acciones">
                  {excepcion.acciones.map((accion) => (
                    <Accion key={accion.etiqueta} accion={accion} />
                  ))}
                </div>
              </Renglon>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta
          id="conciliacion-fuentes"
          titulo="Fuentes"
          acciones={
            <>
              <Accion accion={{ etiqueta: "Actualizar", tipo: "secundaria" }} icono={<IconoConciliacion />} />
              <Accion accion={{ etiqueta: "Agregar", tipo: "secundaria" }} icono={<IconoMas />} />
            </>
          }
        >
          <ul className="demo-lista">
            {datos.fuentes.map((fuente, i) => {
              const Icono = ICONO_DE_FUENTE[i] ?? IconoCuenta;
              return (
                <Renglon
                  key={fuente.titulo}
                  icono={<Icono />}
                  titulo={fuente.titulo}
                  detalle={
                    <>
                      {fuente.detalle}
                      {fuente.alerta ? (
                        <>
                          <br />
                          <span className="demo-alerta-texto">
                            {fuente.alerta}
                          </span>
                        </>
                      ) : null}
                    </>
                  }
                >
                  <Estado estado={fuente.estado} />
                </Renglon>
              );
            })}
          </ul>
        </Tarjeta>
      </div>
      <Tarjeta
        id="conciliacion-recientes"
        titulo="Conciliado recientemente"
        acciones={<Accion accion={{ etiqueta: "Póliza contable", tipo: "secundaria" }} />}
      >
        <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de lo conciliado recientemente">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Movimiento</th>
                <th scope="col" className="derecha">
                  Monto
                </th>
                <th scope="col">Se empató con</th>
                <th scope="col">Póliza</th>
              </tr>
            </thead>
            <tbody>
              {datos.recientes.map((fila) => (
                <tr key={fila.poliza}>
                  <td className="demo-num">{fila.fecha}</td>
                  <td>
                    {fila.movimiento}
                    <small>{fila.origen}</small>
                  </td>
                  <td className="derecha">{pesos(fila.centavos)}</td>
                  <td>
                    {fila.empate}
                    <small>{fila.porque}</small>
                  </td>
                  <td className="demo-mono">{fila.poliza}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
      <p className="demo-nota-fina">{datos.nota}</p>
    </>
  );
}
