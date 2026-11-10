import Link from "next/link";

import { IconoMas } from "@/components/cromo/iconos";
import { BarraAvance } from "@/components/sistema";
import type { TarjetaDemo, TarjetasDemo } from "@/dominio/demo/tarjetas";
import { enEmpresa } from "@/nucleo/rutas";

import { Accion, ChipTarjeta, Cifras, Estado, iniciales, pesos, pesosRedondos, Tarjeta } from "../piezas";

function acabado(tarjeta: TarjetaDemo): "plata" | "negra" | "virtual" {
  if (tarjeta.forma === "Virtual") return "virtual";
  return tarjeta.destacada ? "plata" : "negra";
}

function Pestanas({ empresaId, vista }: { empresaId: string | null; vista: "tarjetas" | "presupuestos" }) {
  const base = enEmpresa(empresaId, "/consola/tarjetas");
  return (
    <nav className="segmentado" aria-label="Vista de tarjetas">
      <Link href={base} aria-current={vista === "tarjetas" ? "page" : undefined}>
        Tarjetas
      </Link>
      <Link href={`${base}?vista=presupuestos`} aria-current={vista === "presupuestos" ? "page" : undefined}>
        Presupuestos por área
      </Link>
    </nav>
  );
}

/**
 * plat-04: las tarjetas precargadas de la empresa. En el producto serán de
 * Efevoo (precargada, como el crédito garantizado de Revolut); hoy no hay
 * integración y todo es de ejemplo.
 */
export function VistaTarjetas({
  datos,
  empresaId,
  vista,
}: {
  datos: TarjetasDemo;
  empresaId: string | null;
  vista: "tarjetas" | "presupuestos";
}) {
  if (vista === "presupuestos") {
    return (
      <>
        <div className="demo-barra-herramientas">
          <Pestanas empresaId={empresaId} vista={vista} />
        </div>
        <Cifras cifras={datos.cifrasPresupuesto} etiqueta="Presupuestos de octubre" />
        <div className="demo-barra-herramientas">
          <p className="demo-tenue">
            Cada área tiene su presupuesto; cada tarjeta, su límite mensual, recarga automática, tope por compra y categorías.
          </p>
          <span className="demo-empuje" />
          <Accion accion={{ etiqueta: "Editar presupuestos por área", tipo: "secundaria" }} />
        </div>
        <Tarjeta id="tarjetas-presupuestos" titulo="Presupuesto por área">
          {datos.presupuestos.map((area) => (
            <div className="demo-presupuesto" key={area.area}>
              <div className="demo-presupuesto-cabeza">
                <b>{area.area}</b>
                <span className="demo-cifra-numero">
                  {pesosRedondos(area.gastadoCentavos)} <small className="demo-tenue">de {pesosRedondos(area.presupuestoCentavos)}</small>
                </span>
              </div>
              <BarraAvance valor={area.gastadoCentavos} tope={area.presupuestoCentavos} etiqueta={`${area.area}: gastado contra presupuesto`} />
              <small data-tono={area.alerta ? "aviso" : undefined}>
                {area.nota} · repartido en tarjetas {pesosRedondos(area.repartidoCentavos)}
              </small>
            </div>
          ))}
          <p className="demo-nota-fina">{datos.proyeccion}</p>
        </Tarjeta>
      </>
    );
  }
  return (
    <>
      <div className="demo-barra-herramientas">
        <Pestanas empresaId={empresaId} vista={vista} />
      </div>
      <Cifras cifras={datos.cifras} etiqueta="Tarjetas en cifras" />
      <div className="demo-barra-herramientas">
        <h2 className="demo-titulo-seccion">Todas las tarjetas</h2>
        <span className="demo-empuje" />
        <Accion accion={{ etiqueta: "Nueva tarjeta", tipo: "principal" }} chico={false} icono={<IconoMas />} />
      </div>
      <section className="hoja" aria-label="Todas las tarjetas">
        <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de todas las tarjetas">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Tarjeta</th>
                <th scope="col">Persona o comercio</th>
                <th scope="col" className="derecha">
                  Presupuesto mensual
                </th>
                <th scope="col" className="derecha">
                  Gastado este mes
                </th>
                <th scope="col" className="derecha">
                  Saldo asignado
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {datos.tarjetas.map((tarjeta) => (
                <tr key={tarjeta.terminacion}>
                  <td>
                    <span className="demo-persona">
                      <ChipTarjeta acabado={acabado(tarjeta)} />
                      <span>
                        <b>
                          {tarjeta.nombre} <span className="demo-mono demo-tenue">••{tarjeta.terminacion}</span>
                        </b>
                        <small>{tarjeta.forma}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="demo-persona">
                      <span className="demo-iniciales" aria-hidden="true">
                        {iniciales(tarjeta.titular)}
                      </span>
                      <span>
                        <b>{tarjeta.titular}</b>
                        <small>{tarjeta.area}</small>
                      </span>
                    </span>
                  </td>
                  <td className="derecha">{tarjeta.presupuestoCentavos === null ? "Sin tope" : pesos(tarjeta.presupuestoCentavos)}</td>
                  <td className="derecha">
                    {pesos(tarjeta.gastadoCentavos)}
                    {tarjeta.presupuestoCentavos !== null ? (
                      <BarraAvance
                        valor={tarjeta.gastadoCentavos}
                        tope={tarjeta.presupuestoCentavos}
                        etiqueta={`${tarjeta.nombre} ••${tarjeta.terminacion}: gastado contra presupuesto`}
                      />
                    ) : null}
                  </td>
                  <td className="derecha">{pesos(tarjeta.saldoCentavos)}</td>
                  <td>
                    <Estado estado={tarjeta.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
