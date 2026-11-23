import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { etiquetaEstado, fechaDia } from "@/components/operacion/formato";
import { FormularioComision } from "@/components/operacion/formulario-comision";
import { FormularioAsignarPlan, FormularioPlan } from "@/components/operacion/formulario-plan";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Insignia, Metrica, Metricas, Monto, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { nombreDelMes, textoComision } from "@/dominio/operacion";
import { cobroDelMes, exigirContextoOperacion, listarClientes, listarComisiones, listarPlanes } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Comisiones · Operación" };

export default async function ComisionesOperacion({ searchParams }: { searchParams: Parametros<"aviso" | "mes"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  const [clientes, versiones, planes, cobro] = await Promise.all([
    listarClientes(ctx),
    listarComisiones(ctx),
    listarPlanes(ctx),
    cobroDelMes(ctx, params.mes),
  ]);
  const propone = puedeEnOperacion(ctx, "plataforma.empresa.alta");
  const activos = clientes.filter((cliente) => cliente.estado === "activa");
  const conPlan = cobro.clientes.filter((cliente) => cliente.plan !== null).length;
  const mensualidades = cobro.clientes.reduce((suma, cliente) => suma + cliente.mensualidadCentavos, 0);
  const spei = cobro.clientes.reduce((suma, cliente) => suma + cliente.speiCentavosTotal, 0);
  const hayEjemplo = planes.some((plan) => plan.deEjemplo);
  const mes = nombreDelMes(cobro.periodo.mes);
  return (
    <PaginaOperacion titulo="Comisiones" aviso={params.aviso}>
      <Metricas etiqueta={`Cobro de ${mes}`}>
        <Metrica rotulo={`Por cobrar en ${mes}`} nota="Mensualidades más SPEI">
          <Monto>{formatoPesos(cobro.totalCentavos)}</Monto>
        </Metrica>
        <Metrica rotulo="Mensualidades" nota={`${conPlan} de ${cobro.clientes.length} ${cobro.clientes.length === 1 ? "cliente" : "clientes"} con plan`}>
          <Monto>{formatoPesos(mensualidades)}</Monto>
        </Metrica>
        <Metrica rotulo="SPEI" nota={`${cobro.clientes.reduce((suma, cliente) => suma + cliente.spei, 0)} en el mes`}>
          <Monto>{formatoPesos(spei)}</Monto>
        </Metrica>
      </Metricas>

      <Rejilla
        principal={
          <Hoja id="cobro-titulo" titulo={`Qué se le cobra a cada cliente · ${mes}`}>
            <form method="get" className="cobro-mes" aria-label="Elegir el mes">
              <label htmlFor="mes">Mes</label>
              <input id="mes" name="mes" type="month" defaultValue={cobro.periodo.mes} />
              <button type="submit" className="boton boton-secundario">
                Ver
              </button>
            </form>
            {cobro.clientes.length === 0 ? (
              <Vacio titulo="Aún no hay clientes">
                Cuando des de alta un cliente, aquí verás su plan, su mensualidad, sus SPEI del mes y el total.
              </Vacio>
            ) : (
              <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla del cobro por cliente">
                <table className="tabla operacion-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Cliente</th>
                      <th scope="col">Plan</th>
                      <th scope="col">Mensualidad</th>
                      <th scope="col">SPEI</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cobro.clientes.map((cliente) => (
                      <tr key={cliente.companyId}>
                        <td>
                          <Link href={`/operacion/clientes/${cliente.companyId}`}>{cliente.razonSocial}</Link>
                          <small>
                            {cliente.rfc} · {etiquetaEstado(cliente.estado)}
                          </small>
                        </td>
                        <td data-rotulo="Plan">{cliente.plan ? cliente.plan.nombre : <Insignia tono="aviso">Sin plan</Insignia>}</td>
                        <td data-rotulo="Mensualidad">{formatoPesos(cliente.mensualidadCentavos)}</td>
                        <td data-rotulo="SPEI">
                          {formatoPesos(cliente.speiCentavosTotal)}
                          <small>
                            {cliente.spei} × {formatoPesos(cliente.speiCentavos)}
                            {cliente.fuenteSpei === "tarifa_propia" ? " · tarifa especial" : ""}
                          </small>
                        </td>
                        <td data-rotulo="Total">
                          <strong>{formatoPesos(cliente.totalCentavos)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Hoja>
        }
        lateral={
          propone ? (
            <Hoja id="asignar-titulo" titulo="Asignar plan a un cliente">
              {cobro.clientes.length === 0 || planes.length === 0 ? (
                <Vacio titulo="Sin clientes">Da de alta un cliente para asignarle un plan.</Vacio>
              ) : (
                <FormularioAsignarPlan
                  clientes={cobro.clientes.map((cliente) => ({
                    id: cliente.companyId,
                    nombre: `${cliente.razonSocial} · ${cliente.plan ? cliente.plan.nombre : "sin plan"}`,
                    planId: cliente.plan?.id ?? null,
                  }))}
                  planes={planes.map((plan) => ({ id: plan.id, nombre: `${plan.nombre} · ${formatoPesos(plan.mensualidadCentavos)} al mes` }))}
                />
              )}
            </Hoja>
          ) : undefined
        }
      />

      <Hoja id="planes-titulo" titulo="Planes">
        {hayEjemplo ? (
          <p className="pista">
            Los planes marcados «Monto de ejemplo» traen cifras de muestra. Escribe tus montos y guarda cada plan.
          </p>
        ) : null}
        {planes.length === 0 ? (
          <Vacio titulo="Sin planes">No hay planes para este operador.</Vacio>
        ) : (
          <div className="planes-rejilla">
            {planes.map((plan) => (
              <article key={plan.id} className="plan-tarjeta" aria-labelledby={`plan-${plan.nivel}-titulo`}>
                <header>
                  <h3 id={`plan-${plan.nivel}-titulo`}>
                    Nivel {plan.nivel} · {plan.nombre}
                  </h3>
                  {plan.deEjemplo ? <Insignia tono="aviso">Monto de ejemplo</Insignia> : null}
                </header>
                {propone ? (
                  <FormularioPlan plan={plan} />
                ) : (
                  <dl className="plan-cifras">
                    <dt>Mensualidad</dt>
                    <dd>{formatoPesos(plan.mensualidadCentavos)}</dd>
                    <dt>Costo por SPEI</dt>
                    <dd>{formatoPesos(plan.speiCentavos)}</dd>
                  </dl>
                )}
              </article>
            ))}
          </div>
        )}
      </Hoja>

      <Rejilla
        principal={
          <Hoja id="versiones-titulo" titulo="Tarifas especiales por cliente">
            {versiones.length === 0 ? (
              <Vacio titulo="Sin tarifas especiales">Un cliente sin tarifa especial paga el costo por SPEI de su plan.</Vacio>
            ) : (
              <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de versiones de comisiones">
                <table className="tabla operacion-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Empresa</th>
                      <th scope="col">Tarifa</th>
                      <th scope="col">Vigencia</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versiones.map((version) => (
                      <tr key={version.id}>
                        <td>
                          <Link href={`/operacion/clientes/${version.companyId}`}>{version.razonSocial}</Link>
                          <small>Propuso {version.solicitante}</small>
                        </td>
                        <td data-rotulo="Tarifa">{textoComision(version.tipo, version.valor)}</td>
                        <td data-rotulo="Vigencia">
                          {fechaDia(version.vigenteDesde)}
                          {version.vigenteHasta ? <small>hasta {fechaDia(version.vigenteHasta)}</small> : null}
                        </td>
                        <td data-rotulo="Estado">
                          <Insignia tono={version.estado === "vigente" ? "sello" : "neutro"}>{etiquetaEstado(version.estado)}</Insignia>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Hoja>
        }
        lateral={
          propone ? (
            <Hoja id="proponer-titulo" titulo="Proponer una tarifa especial">
              {activos.length === 0 ? (
                <Vacio titulo="Sin empresas activas">Activa un cliente antes de configurar su tarifa.</Vacio>
              ) : (
                <FormularioComision empresas={activos.map((cliente) => ({ id: cliente.id, nombre: `${cliente.razonSocial} · ${cliente.rfc}` }))} />
              )}
            </Hoja>
          ) : undefined
        }
      />
      <NotaRegla>
        Esta pantalla calcula lo que se le cobraría a cada cliente; no genera cargos ni mueve dinero. Un SPEI es un pago a
        proveedor autorizado en el mes. Si el cliente tiene una tarifa especial de SPEI vigente, se usa en lugar de la de su
        plan. Las tarifas especiales las propone una persona y las autoriza otra.
      </NotaRegla>
    </PaginaOperacion>
  );
}
