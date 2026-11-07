import Link from "next/link";

import "@/estilo/flujo.css";

import { BarraAvance, CabezaPagina, EtiquetaMono, Hoja, Insignia, Metrica, Metricas, Monto, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { ETIQUETA_FRECUENCIA } from "@/dominio/flujo/entradas";
import { desplazar, fechaConAnio, fechaCorta, nombreDelMes, primeroDelMes, ultimoDelMes } from "@/dominio/flujo/fechas";
import { ETIQUETA_ESTADO_PRESUPUESTO, GASTO_RESERVADO, porcentaje, type LineaPresupuesto } from "@/dominio/flujo/presupuestos";
import { horaEnMexico } from "@/dominio/reloj";
import { enEmpresa } from "@/nucleo/rutas";
import type { CobroVista } from "@/server/flujo/repositorio";
import type { VistaCalendario, VistaCobros, VistaPresupuestos, VistaSaldo } from "@/server/flujo/servicio";

import { Calendario } from "./calendario";
import {
  AreaProveedor,
  AvisosDeLista,
  DesactivarObligacion,
  FormularioCobro,
  FormularioCobroXml,
  FormularioColchon,
  FormularioCorreo,
  FormularioObligacion,
  FormularioSaldo,
  ResolverCobro,
} from "./formularios";
import { Origen } from "./origen";

function SinLectura({ kicker, titulo }: { kicker: string; titulo: string }) {
  return (
    <CabezaPagina kicker={kicker} titulo={titulo}>
      <p className="lede">No se pudo consultar. Vuelve a intentar.</p>
    </CabezaPagina>
  );
}

const SOLO_LECTURA = "Tu rol ve el flujo de caja; lo cambian administración o finanzas.";

// Saldo y alertas ---------------------------------------------------------------------

export function VistaFlujo({ vista }: { vista: VistaSaldo | null }) {
  if (!vista) return <SinLectura kicker="Flujo de caja" titulo="Saldo y alertas" />;
  return (
    <>
      {/* El título y la acción viven en la barra del Marco; el h1 queda para el lector de pantalla. */}
      <h1 className="solo-lector">Saldo y alertas</h1>
      <Rejilla
        principal={
          <>
            <Hoja id="declarar" titulo="Declarar el saldo en bancos">
              {vista.puedeEditar ? (
                <FormularioSaldo hoy={vista.hoy} altaId={vista.altaId} />
              ) : (
                <NotaRegla>{SOLO_LECTURA}</NotaRegla>
              )}
              <p className="pista">Cada declaración queda en el historial con su fecha y su autor. Una nueva no borra la anterior.</p>
            </Hoja>
            <Hoja id="historial-titulo" titulo="Historial de saldos declarados" className="flujo-bloque">
              {vista.historial.length === 0 ? (
                <Vacio titulo="Todavía no hay saldos declarados.">Inicio muestra lo comprometido hasta que alguien declare el primero.</Vacio>
              ) : (
                <div className="tabla-contenedor">
                  <table className="tabla flujo-historial" data-tabla="historial-saldo">
                    <thead>
                      <tr>
                        <th scope="col">Al cierre del</th>
                        <th scope="col" className="derecha">Saldo <Origen de="declarado" /></th>
                        <th scope="col">Declaró</th>
                        <th scope="col">Cuándo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vista.historial.map((fila) => (
                        <tr key={fila.id} data-declaracion={fila.id}>
                          <td>{fechaConAnio(fila.alDia)}</td>
                          <td className="cifra" data-centavos={fila.centavos}>{formatoPesos(fila.centavos)}</td>
                          <td>{fila.autor}</td>
                          <td>{horaEnMexico(new Date(fila.declaradoEn))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Hoja>
          </>
        }
        lateral={
          <>
            <Hoja id="colchon-titulo" titulo="Colchón">
              {vista.puedeEditar ? (
                <FormularioColchon colchonCentavos={vista.colchonCentavos} />
              ) : (
                <p data-cifra="colchon">{vista.colchonCentavos > 0 ? formatoPesos(vista.colchonCentavos) : "Sin colchón: la alerta avisa solo en negativo."}</p>
              )}
            </Hoja>
            <Hoja id="correo-titulo" titulo="Resumen de los lunes" className="flujo-bloque">
              <p className="pista">Saldo declarado, lo comprometido a 4 semanas, alertas de faltante y de presupuesto y cobros vencidos.</p>
              <FormularioCorreo activo={vista.correoSemanal} />
            </Hoja>
          </>
        }
      />
    </>
  );
}

// Cobros ----------------------------------------------------------------------------------

const FILTROS_ESTADO = [
  ["todos", "Todos"],
  ["esperado", "Esperados"],
  ["vencido", "Vencidos"],
  ["cobrado", "Cobrados"],
  ["cancelado", "Cancelados"],
] as const;

const FILTROS_VENCE = [
  ["todas", "Cualquier fecha"],
  ["7", "Próximos 7 días"],
  ["30", "Próximos 30 días"],
] as const;

function vencido(cobro: CobroVista, hoy: string): boolean {
  return cobro.estado === "esperado" && cobro.fechaProbable < hoy;
}

export function filtrarCobros(cobros: readonly CobroVista[], hoy: string, estado: string, vence: string): CobroVista[] {
  return cobros.filter((cobro) => {
    if (estado === "vencido" && !vencido(cobro, hoy)) return false;
    if (estado === "esperado" && (cobro.estado !== "esperado" || vencido(cobro, hoy))) return false;
    if ((estado === "cobrado" || estado === "cancelado") && cobro.estado !== estado) return false;
    if (vence === "7" || vence === "30") {
      if (cobro.estado !== "esperado" || cobro.fechaProbable < hoy || cobro.fechaProbable > desplazar(hoy, Number(vence))) return false;
    }
    return true;
  });
}

export function VistaCobrosPagina({
  vista,
  empresaId,
  estado: estadoPedido,
  vence: vencePedido,
}: {
  vista: VistaCobros | null;
  empresaId: string | null;
  estado?: string;
  vence?: string;
}) {
  if (!vista) return <SinLectura kicker="Flujo de caja" titulo="Cobros esperados" />;
  const estado = FILTROS_ESTADO.some(([clave]) => clave === estadoPedido) ? estadoPedido! : "todos";
  const vence = FILTROS_VENCE.some(([clave]) => clave === vencePedido) ? vencePedido! : "todas";
  const lista = filtrarCobros(vista.cobros, vista.hoy, estado, vence);
  const enlace = (cambio: { estado?: string; vence?: string }) => {
    const e = cambio.estado ?? estado;
    const v = cambio.vence ?? vence;
    const query = [e !== "todos" ? `estado=${e}` : "", v !== "todas" ? `vence=${v}` : ""].filter(Boolean).join("&");
    return enEmpresa(empresaId, `/consola/cobros${query ? `?${query}` : ""}`);
  };
  return (
    <>
      <h1 className="solo-lector">Cobros esperados</h1>
      <Metricas etiqueta="Totales de cobros">
        <Metrica rotulo="Por cobrar" nota={<Origen de="comprometido" />}>
          <Monto><span data-cifra="por-cobrar" data-centavos={vista.totales.porCobrar}>{formatoPesos(vista.totales.porCobrar)}</span></Monto>
        </Metrica>
        <Metrica rotulo={vista.totales.vencidos === 1 ? "1 cobro vencido" : `${vista.totales.vencidos} cobros vencidos`} nota="No entran en la proyección.">
          <Monto><span data-cifra="vencidos" data-centavos={vista.totales.vencidosCentavos}>{formatoPesos(vista.totales.vencidosCentavos)}</span></Monto>
        </Metrica>
      </Metricas>

      <Hoja id="lista-cobros" titulo="Cobros" className="flujo-bloque">
        <AvisosDeLista>
          <div className="flujo-filtros">
            <nav className="segmentado" aria-label="Estado">
              {FILTROS_ESTADO.map(([clave, texto]) => (
                <Link key={clave} href={enlace({ estado: clave })} aria-current={estado === clave ? "page" : undefined}>{texto}</Link>
              ))}
            </nav>
            <nav className="segmentado" aria-label="Vencimiento">
              {FILTROS_VENCE.map(([clave, texto]) => (
                <Link key={clave} href={enlace({ vence: clave })} aria-current={vence === clave ? "page" : undefined}>{texto}</Link>
              ))}
            </nav>
          </div>
          {lista.length === 0 ? (
            <Vacio titulo={vista.cobros.length === 0 ? "Todavía no hay cobros esperados." : "Ningún cobro con estos filtros."}>
              {vista.cobros.length === 0 ? "Registra el primero a mano o con el XML de una factura que emitiste." : undefined}
            </Vacio>
          ) : (
            <div className="tabla-contenedor">
              {/* Roles explícitos: en móvil cada cobro se apila como tarjeta y la tabla sigue siendo tabla para el lector de pantalla. */}
              <table className="tabla flujo-apilada flujo-tabla-cobros" data-tabla="cobros" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">Cliente</th>
                    <th scope="col" role="columnheader">Concepto</th>
                    <th scope="col" role="columnheader">Fecha probable</th>
                    <th scope="col" role="columnheader" className="derecha">Monto</th>
                    <th scope="col" role="columnheader">Estado</th>
                    {vista.puedeEditar ? <th scope="col" role="columnheader"><span className="solo-lector">Acciones</span></th> : null}
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {lista.map((cobro) => (
                    <tr key={cobro.id} role="row" data-cobro={cobro.id} data-estado={vencido(cobro, vista.hoy) ? "vencido" : cobro.estado}>
                      <td role="cell" data-columna="cliente">{cobro.cliente}{cobro.rfc ? <small>{cobro.rfc}</small> : null}</td>
                      <td role="cell" data-columna="concepto">{cobro.concepto}{cobro.referencia ? <small>{cobro.origen === "cfdi" ? "Factura " : ""}{cobro.referencia}</small> : null}</td>
                      <td role="cell" data-columna="fecha" data-etiqueta="Fecha probable">{fechaCorta(cobro.fechaProbable)}</td>
                      <td role="cell" data-columna="monto" className="cifra">{formatoPesos(cobro.montoCentavos)}</td>
                      <td role="cell" data-columna="estado"><EstadoCobro cobro={cobro} hoy={vista.hoy} /></td>
                      {vista.puedeEditar ? (
                        <td role="cell" data-columna="acciones">{cobro.estado === "esperado" ? <ResolverCobro id={cobro.id} cliente={cobro.cliente} montoCentavos={cobro.montoCentavos} hoy={vista.hoy} /> : null}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AvisosDeLista>
      </Hoja>

      {vista.puedeEditar ? (
        <Rejilla
          principal={<Hoja id="nuevo-cobro" titulo="Registrar un cobro" className="flujo-bloque"><FormularioCobro hoy={vista.hoy} altaId={vista.altaIds.manual} /></Hoja>}
          lateral={<Hoja id="cobro-xml" titulo="Desde una factura emitida" className="flujo-bloque"><FormularioCobroXml hoy={vista.hoy} altaId={vista.altaIds.xml} /></Hoja>}
        />
      ) : (
        <NotaRegla>{SOLO_LECTURA}</NotaRegla>
      )}
    </>
  );
}

function EstadoCobro({ cobro, hoy }: { cobro: CobroVista; hoy: string }) {
  if (vencido(cobro, hoy)) return <Insignia tono="aviso">Vencido</Insignia>;
  if (cobro.estado === "cobrado") return <><Insignia tono="sello">Cobrado</Insignia><small>el {fechaCorta(cobro.cobradoEl ?? cobro.fechaProbable)}</small></>;
  if (cobro.estado === "cancelado") return <><Insignia>Cancelado</Insignia>{cobro.motivo ? <small>{cobro.motivo}</small> : null}</>;
  return <Insignia>Esperado</Insignia>;
}

// Calendario ------------------------------------------------------------------------------

export function VistaCalendarioPagina({ vista, empresaId }: { vista: VistaCalendario | null; empresaId: string | null }) {
  if (!vista) return <SinLectura kicker="Flujo de caja" titulo="Calendario de obligaciones" />;
  const anterior = desplazar(primeroDelMes(vista.mes), -1).slice(0, 7);
  const siguiente = desplazar(ultimoDelMes(vista.mes), 1).slice(0, 7);
  return (
    <>
      <h1 className="solo-lector">Calendario de obligaciones</h1>
      <Hoja id="mes-titulo" titulo={nombreDelMes(vista.mes)}>
        <div className="flujo-mes-navegacion">
          <p className="flujo-leyenda"><Origen de="comprometido" /> cada fecha sale de un dato registrado en la plataforma</p>
          <nav className="segmentado" aria-label="Mes">
            <Link href={enEmpresa(empresaId, `/consola/calendario?mes=${anterior}`)}>← Mes anterior</Link>
            <Link href={enEmpresa(empresaId, "/consola/calendario")}>Este mes</Link>
            <Link href={enEmpresa(empresaId, `/consola/calendario?mes=${siguiente}`)}>Mes siguiente →</Link>
          </nav>
        </div>
        <Calendario mes={vista.mes} hoy={vista.hoy} eventos={vista.eventos} proximos={vista.proximos} />
      </Hoja>

      <Rejilla
        principal={
          <Hoja id="obligaciones-titulo" titulo="Obligaciones recurrentes" className="flujo-bloque">
            <AvisosDeLista>
              {vista.obligaciones.length === 0 ? (
                <Vacio titulo="Todavía no hay obligaciones recurrentes.">Renta, software, seguros o impuestos: lo que tu empresa paga cada cierto tiempo.</Vacio>
              ) : (
                <ul className="flujo-lista" data-lista="obligaciones">
                  {vista.obligaciones.map((o) => (
                    <li key={o.id} data-obligacion={o.id}>
                      <span>
                        <strong>{o.concepto}</strong> · {ETIQUETA_FRECUENCIA[o.frecuencia].toLowerCase()} · próxima el {fechaCorta(o.proximaFecha)}
                        {o.areaNombre ? <> · {o.areaNombre}</> : null}
                        {o.proveedorNombre ? <> · la factura {o.proveedorNombre}</> : null}
                      </span>
                      <span className="flujo-acciones-fila">
                        <strong>{formatoPesos(o.montoCentavos)}</strong>
                        {vista.puedeEditar ? <DesactivarObligacion id={o.id} concepto={o.concepto} /> : null}
                      </span>
                      {vista.puedeEditar ? (
                        <details>
                          <summary>Editar</summary>
                          <FormularioObligacion areas={vista.areas} proveedores={vista.proveedores} hoy={vista.hoy} obligacion={o} />
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </AvisosDeLista>
          </Hoja>
        }
        lateral={
          <Hoja id="nueva-obligacion" titulo="Nueva obligación" className="flujo-bloque">
            {vista.puedeEditar ? (
              <FormularioObligacion areas={vista.areas} proveedores={vista.proveedores} hoy={vista.hoy} altaId={vista.altaId} />
            ) : (
              <NotaRegla>{SOLO_LECTURA}</NotaRegla>
            )}
          </Hoja>
        }
      />
    </>
  );
}

// Presupuestos -----------------------------------------------------------------------------

export function VistaPresupuestosPagina({ vista, empresaId }: { vista: VistaPresupuestos | null; empresaId: string | null }) {
  if (!vista) return <SinLectura kicker="Flujo de caja" titulo="Presupuestos" />;
  const { presupuestos } = vista;
  return (
    <>
      <h1 className="solo-lector">Presupuestos</h1>
      <Hoja id="areas-titulo" titulo={`Por área · ${nombreDelMes(vista.hoy)}`}>
        <p className="pista">Gasto del mes = nómina neta del área prorrateada al mes + pagos a proveedores del área (no rechazados ni cancelados) programados en el mes + obligaciones del área. Atención desde el 80 %, excedido desde el 100 %. <Origen de="comprometido" /></p>
        {presupuestos.areas.length === 0 ? (
          <Vacio titulo="Todavía no hay áreas.">Las áreas y su presupuesto se crean en <Link href={enEmpresa(empresaId, "/consola/personas/areas")}>Personas</Link>.</Vacio>
        ) : (
          presupuestos.areas.map((linea) => <LineaVista key={linea.id} linea={linea} />)
        )}
      </Hoja>
      <Hoja id="personas-titulo" titulo="Por persona" className="flujo-bloque">
        <p className="pista">Gasto del mes = pagos a proveedores que la persona solicitó, programados en el mes. La nómina va aparte. <Origen de="comprometido" /></p>
        {presupuestos.personas.length === 0 ? (
          <Vacio titulo="Nadie tiene una bolsa mensual asignada.">La bolsa de cada persona se asigna en su ficha de Personas.</Vacio>
        ) : (
          presupuestos.personas.map((linea) => <LineaVista key={linea.id} linea={linea} />)
        )}
      </Hoja>
      <Hoja id="proveedores-area" titulo="Área de cada proveedor" className="flujo-bloque">
        <p className="pista">Los pagos de un proveedor suman al presupuesto de su área. Sin área, no suman a ninguna.</p>
        {vista.proveedores.length === 0 ? (
          <Vacio titulo="Todavía no hay proveedores." />
        ) : (
          <ul className="flujo-lista" data-lista="proveedores-area">
            {vista.proveedores.map((proveedor) => (
              <li key={proveedor.id}>
                {vista.puedeEditar ? (
                  <AreaProveedor proveedor={proveedor} areas={vista.areas} />
                ) : (
                  <>
                    <span>{proveedor.nombre} <EtiquetaMono nombre="RFC">{proveedor.rfc}</EtiquetaMono></span>
                    <span>{proveedor.areaNombre ?? "Sin área"}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Hoja>
    </>
  );
}

function LineaVista({ linea }: { linea: LineaPresupuesto }) {
  const pct = porcentaje(linea.gastoCentavos, linea.presupuestoCentavos);
  const tono = linea.estado === "excedido" ? "aviso" : linea.estado === "atencion" ? "sello" : "neutro";
  return (
    <div className="flujo-presupuesto" data-presupuesto={linea.id} data-estado={linea.estado}>
      <div className="flujo-presupuesto-cabeza">
        <h3>{linea.nombre}{linea.detalle ? <small className="pista"> · {linea.detalle}</small> : null}</h3>
        <Insignia tono={tono}>{ETIQUETA_ESTADO_PRESUPUESTO[linea.estado]}{pct !== null ? ` · ${pct} %` : ""}</Insignia>
      </div>
      {linea.gastoCentavos === null ? (
        // Nómina de una sola persona sin permiso de detalle: el gasto sería su neto. Quedan estado y presupuesto.
        <p className="flujo-presupuesto-cifras" data-gasto="reservado">
          <span data-cifra="gasto">Gasto reservado</span>
          {linea.presupuestoCentavos !== null ? <> · presupuesto de {formatoPesos(linea.presupuestoCentavos)}</> : " · sin presupuesto asignado"}
          <small className="pista"> {GASTO_RESERVADO}</small>
        </p>
      ) : (
        <>
          <p className="flujo-presupuesto-cifras">
            <span data-cifra="gasto" data-centavos={linea.gastoCentavos}>{formatoPesos(linea.gastoCentavos)}</span>
            {linea.presupuestoCentavos !== null ? <> de {formatoPesos(linea.presupuestoCentavos)}</> : " · sin presupuesto asignado"}
          </p>
          {linea.presupuestoCentavos !== null && linea.presupuestoCentavos > 0 ? (
            <BarraAvance valor={linea.gastoCentavos} tope={linea.presupuestoCentavos} etiqueta={`Gasto de ${linea.nombre} contra su presupuesto`} />
          ) : null}
        </>
      )}
      {linea.desglose ? (
        <p className="flujo-desglose">
          Nómina {formatoPesos(linea.desglose.nominaCentavos)} · Proveedores {formatoPesos(linea.desglose.proveedoresCentavos)} · Obligaciones {formatoPesos(linea.desglose.obligacionesCentavos)}
        </p>
      ) : null}
    </div>
  );
}
