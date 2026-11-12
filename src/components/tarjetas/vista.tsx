import Link from "next/link";

import { AvisosDeLista } from "@/components/flujo/formularios";
import { ChipTarjeta, Cifras, Estado, iniciales, pesos } from "@/components/demo/piezas";
import { Aviso } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import {
  cifrasTarjetas,
  ETIQUETA_ESTADO_OPERACION,
  ETIQUETA_ESTADO_TARJETA,
  ETIQUETA_TIPO_OPERACION,
  operable,
  terminacionSegura,
  TONO_ESTADO_TARJETA,
  type TarjetasEmpresa,
} from "@/dominio/tarjetas/vista";
import { enEmpresa } from "@/nucleo/rutas";

import { AccionesTarjeta, ResolverOperacion } from "./formularios";

const SIN_DATO = "—";

/**
 * Tarjetas de la empresa con Efevoo Pay, con el diseño de la demostración: cifras arriba y la tabla de todas las
 * tarjetas. Solo la terminación; el número completo no llega aquí. Quien no opera ve lo mismo, sin botones.
 */
export function VistaTarjetasEfevoo({ datos, empresaId, puedeOperar }: { datos: TarjetasEmpresa; empresaId: string | null; puedeOperar: boolean }) {
  const cifras = cifrasTarjetas(datos);
  const saldoEmpresa = cifras.saldoEmpresaCentavos;
  return (
    <AvisosDeLista>
      {datos.saldo.tipo === "no_disponible" ? (
        <Aviso titulo="El emisor no respondió el saldo">Las tarjetas se muestran; el saldo para tarjetas se vuelve a pedir al recargar.</Aviso>
      ) : null}
      <Cifras
        etiqueta="Tarjetas en cifras"
        cifras={[
          { rotulo: "Saldo para tarjetas", valor: saldoEmpresa === null ? SIN_DATO : pesos(saldoEmpresa), nota: "Saldo de la empresa en el emisor" },
          { rotulo: "Repartido en tarjetas", valor: cifras.repartidoCentavos === null ? SIN_DATO : pesos(cifras.repartidoCentavos), nota: "Suma del saldo de cada tarjeta" },
          { rotulo: "Tarjetas activas", valor: String(cifras.activas), nota: "Sin contar las canceladas" },
          { rotulo: "Bloqueadas", valor: String(cifras.bloqueadas), nota: "No aceptan pagos", tono: cifras.bloqueadas > 0 ? "aviso" : undefined },
        ]}
      />
      {datos.porAtender.length > 0 ? (
        <section className="hoja" aria-labelledby="tarjetas-por-atender">
          <div className="demo-hd">
            <h2 id="tarjetas-por-atender">Operaciones por confirmar</h2>
            <small>El emisor no las confirmó; no se repiten solas</small>
          </div>
          <ul className="demo-lista">
            {datos.porAtender.map((op) => (
              <li className="demo-li" key={op.id} data-operacion={op.referencia}>
                <div className="demo-li-texto">
                  <b>
                    {ETIQUETA_TIPO_OPERACION[op.tipo]} · ••{terminacionSegura(op.terminacion)}
                    {op.montoCentavos === null ? null : ` · ${formatoPesos(op.montoCentavos)}`}
                  </b>
                  <small>
                    {ETIQUETA_ESTADO_OPERACION[op.estado]} · referencia <span className="demo-mono">{op.referencia}</span>
                    {op.buscadaSinEncontrar ? " · no apareció en el emisor" : null}
                  </small>
                </div>
                {puedeOperar && op.estado === "incierta" ? <ResolverOperacion id={op.id} referencia={op.referencia} conciliada={op.buscadaSinEncontrar} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="demo-barra-herramientas">
        <h2 className="demo-titulo-seccion">Todas las tarjetas</h2>
      </div>
      {datos.tarjetas.length === 0 ? (
        <p className="demo-tenue">Todavía no hay tarjetas. Lever las asigna a las personas de la empresa.</p>
      ) : (
        <section className="hoja" aria-label="Las tarjetas de la empresa">
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de las tarjetas de la empresa">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Tarjeta</th>
                  <th scope="col">Titular</th>
                  <th scope="col" className="derecha">Saldo</th>
                  <th scope="col">Estado</th>
                  {puedeOperar ? <th scope="col"><span className="solo-lector">Acciones</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {datos.tarjetas.map((tarjeta) => {
                  const terminacion = terminacionSegura(tarjeta.terminacion);
                  return (
                    <tr key={tarjeta.id}>
                      <td>
                        <span className="demo-persona">
                          <ChipTarjeta acabado={tarjeta.estado === "activa" ? "plata" : "negra"} />
                          <span>
                            <b>
                              <Link href={enEmpresa(empresaId, `/consola/tarjetas/${tarjeta.id}`)}>
                                {tarjeta.nombre} <span className="demo-mono demo-tenue">••{terminacion}</span>
                              </Link>
                            </b>
                          </span>
                        </span>
                      </td>
                      <td>
                        {tarjeta.titular ? (
                          <span className="demo-persona">
                            <span className="demo-iniciales" aria-hidden="true">{iniciales(tarjeta.titular)}</span>
                            <b>{tarjeta.titular}</b>
                          </span>
                        ) : (
                          <span className="demo-tenue">Sin titular</span>
                        )}
                      </td>
                      <td className="derecha">{tarjeta.saldoCentavos === null ? SIN_DATO : pesos(tarjeta.saldoCentavos)}</td>
                      <td>
                        <Estado estado={{ texto: ETIQUETA_ESTADO_TARJETA[tarjeta.estado], tono: TONO_ESTADO_TARJETA[tarjeta.estado] }} />
                      </td>
                      {puedeOperar ? (
                        <td>
                          {operable(tarjeta) ? (
                            <AccionesTarjeta
                              id={tarjeta.id}
                              terminacion={terminacion}
                              estado={tarjeta.estado}
                              saldoTarjetaCentavos={tarjeta.saldoCentavos}
                              saldoEmpresaCentavos={saldoEmpresa}
                            />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AvisosDeLista>
  );
}
