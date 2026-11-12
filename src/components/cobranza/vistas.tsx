import Link from "next/link";
import type { ReactNode } from "react";

import "@/estilo/flujo.css";
import "@/estilo/cobranza.css";

import { AvisosDeLista, FormularioCobro, FormularioCobroXml, ResolverCobro } from "@/components/flujo/formularios";
import { Aviso, EtiquetaMono, Hoja, Insignia, Metrica, Metricas, Monto, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { clabeVisible } from "@/dominio/clabe";
import { CUBETAS, ETIQUETA_CUBETA, type Cubeta } from "@/dominio/cobranza/antiguedad";
import { BANCOS } from "@/dominio/cobranza/estado-cuenta";
import { ETIQUETA_PERIODICIDAD, diasDeAtraso } from "@/dominio/cobranza/periodos";
import { ETIQUETA_TIPO, textoCalendario } from "@/dominio/cobranza/recordatorios";
import { fechaConAnio, fechaCorta } from "@/dominio/flujo/fechas";
import { enEmpresa } from "@/nucleo/rutas";
import type { VistaEstadoDeCuenta } from "@/server/cobranza/estado-cuenta";
import type { FilaCargo, PagoVista } from "@/server/cobranza/repositorio";
import type { Deteccion, VistaCliente, VistaCobranza, VistaConfiguracion, VistaNuevo } from "@/server/cobranza/servicio";

import {
  AccionesCargo,
  AccionesPlan,
  AnularPago,
  AplicarPago,
  ArchivarCliente,
  ConfirmarEstadoDeCuenta,
  EditarCliente,
  FormularioAlta,
  FormularioConfiguracion,
  NuevoCobroDeCliente,
  PagoSinCargo,
  Recordatorios,
  RevertirAplicacion,
  SubirEstadoDeCuenta,
} from "./formularios";

function SinLectura({ titulo }: { titulo: string }) {
  return (
    <>
      <h1 className="solo-lector">{titulo}</h1>
      <Aviso titulo="No pudimos leer la cobranza">La base no respondió. Recarga la página en un momento.</Aviso>
    </>
  );
}

// Piezas ------------------------------------------------------------------------------

export function EstadoCargo({ fila, hoy }: { fila: Pick<FilaCargo, "estado" | "vencimiento" | "pagadoCentavos" | "montoCentavos">; hoy: string }) {
  if (fila.estado === "por_emitir") return <Insignia tono="aviso">Sin monto</Insignia>;
  if (fila.estado === "pagado") return <Insignia tono="sello">Pagado</Insignia>;
  if (fila.estado === "cancelado") return <Insignia>Cancelado</Insignia>;
  if (fila.estado === "omitido") return <Insignia>Omitido por pausa</Insignia>;
  const atraso = diasDeAtraso(fila.vencimiento, hoy);
  const parcial = fila.pagadoCentavos > 0 ? " · pago parcial" : "";
  if (atraso > 0) return <Insignia tono="aviso">{`Vencido hace ${atraso} ${atraso === 1 ? "día" : "días"}${parcial}`}</Insignia>;
  if (fila.vencimiento === hoy) return <Insignia tono="aviso">{`Vence hoy${parcial}`}</Insignia>;
  return <Insignia>{`Por vencer${parcial}`}</Insignia>;
}

function UltimoCorreo({ correo }: { correo: FilaCargo["ultimoCorreo"] }) {
  if (!correo) return <span className="pista">Sin correo</span>;
  const estado = correo.estado === "enviado" ? "enviado" : correo.estado === "simulado" ? "simulado" : correo.estado === "fallido" ? "no salió" : "saliendo";
  return <span className={correo.estado === "fallido" ? "cobranza-fallido" : "pista"}>{ETIQUETA_TIPO[correo.tipo]} {estado} · {fechaCorta(correo.en.slice(0, 10))}</span>;
}

function Deteccion({ deteccion, empresaId, puedeEditar, configurar = false }: { deteccion: Deteccion; empresaId: string; puedeEditar: boolean; configurar?: boolean }) {
  // En la lista, la configuración se abre desde aquí: la barra superior solo cabe una acción a 390 px.
  const enlace = configurar ? <> <Link href={enEmpresa(empresaId, "/consola/cobros/configuracion")}>Configuración de la cobranza</Link></> : null;
  if (deteccion === "fintoc") {
    return <p className="cobranza-deteccion" data-deteccion="fintoc"><Insignia tono="sello">Detección automática</Insignia> Cada cliente tiene su CLABE propia: los depósitos se identifican y se aplican solos.{enlace}</p>;
  }
  if (deteccion === "demo") {
    return <p className="cobranza-deteccion" data-deteccion="demo"><Insignia>Demostración</Insignia> Puedes simular que llega un depósito desde cada cargo. Nada sale ni se mueve.{enlace}</p>;
  }
  return (
    <p className="cobranza-deteccion" data-deteccion="pronto">
      <Insignia>Detección automática: disponible pronto</Insignia> Mientras tanto, registra cada pago a mano o
      {puedeEditar ? <> <Link href={enEmpresa(empresaId, "/consola/cobros/estado-de-cuenta")}>sube tu estado de cuenta</Link></> : " sube tu estado de cuenta"} y Lever lo concilia.{enlace}
    </p>
  );
}

/** La antigüedad de lo pendiente: una barra apilada y, debajo, cada tramo como enlace que filtra la lista. */
function Antiguedad({ resumen, empresaId, activa }: { resumen: VistaCobranza["resumen"]; empresaId: string; activa: Cubeta | null }) {
  const total = CUBETAS.reduce((s, c) => s + resumen.antiguedad[c].centavos, 0);
  return (
    <div className="cobranza-antiguedad">
      <div className="cobranza-barra" role="img" aria-label={`Antigüedad de lo pendiente: ${CUBETAS.map((c) => `${ETIQUETA_CUBETA[c]} ${formatoPesos(resumen.antiguedad[c].centavos)}`).join(", ")}`}>
        {total > 0 ? CUBETAS.map((c) => resumen.antiguedad[c].centavos > 0 ? (
          <i key={c} data-cubeta={c} style={{ width: `${Math.max(2, (resumen.antiguedad[c].centavos / total) * 100)}%` }} />
        ) : null) : <i data-cubeta="vacia" style={{ width: "100%" }} />}
      </div>
      <ul className="cobranza-cubetas">
        {CUBETAS.map((c) => (
          <li key={c}>
            <Link href={enEmpresa(empresaId, activa === c ? "/consola/cobros" : `/consola/cobros?antiguedad=${c}`)} aria-current={activa === c ? "true" : undefined} data-cubeta={c}>
              <span className="cobranza-punto" data-cubeta={c} aria-hidden="true" />
              <span>{ETIQUETA_CUBETA[c]}</span>
              <strong className="cifra" data-centavos={resumen.antiguedad[c].centavos}>{formatoPesos(resumen.antiguedad[c].centavos)}</strong>
              <small>{resumen.antiguedad[c].cargos} {resumen.antiguedad[c].cargos === 1 ? "cargo" : "cargos"}</small>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FILTROS: readonly [string, string][] = [
  ["todos", "Todos"],
  ["por_emitir", "Sin monto"],
  ["por_vencer", "Por vencer"],
  ["vencido", "Vencidos"],
  ["pagado", "Pagados"],
  ["cancelado", "Cancelados"],
];

function textoCargo(c: { cliente: string; concepto: string; saldoCentavos: number; referencia: string }) {
  return `${c.cliente} · ${c.concepto} · ${formatoPesos(c.saldoCentavos)} · ref ${c.referencia}`;
}

// Cobranza (la lista) ----------------------------------------------------------------

export function VistaCobranzaPagina({ vista, empresaId, pestana }: { vista: VistaCobranza | null; empresaId: string; pestana: string }) {
  if (!vista) return <SinLectura titulo="Cobranza" />;
  const { resumen, filtros } = vista;
  const enlace = (cambio: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const actual: Record<string, string | null> = { estado: filtros.estado === "todos" ? null : filtros.estado, antiguedad: filtros.cubeta, q: filtros.q, vista: pestana === "cargos" ? null : pestana };
    for (const [k, v] of Object.entries({ ...actual, ...cambio })) if (v) p.set(k, v);
    const q = p.toString();
    return enEmpresa(empresaId, `/consola/cobros${q ? `?${q}` : ""}`);
  };
  const paginas = Math.max(1, Math.ceil(vista.cargos.total / 50));
  const opcionesAplicar = vista.cargosAbiertos.map((c) => ({ id: c.id, texto: textoCargo(c), clienteId: c.clienteId, saldo: c.saldoCentavos }));
  return (
    <>
      <h1 className="solo-lector">Cobranza</h1>
      {!vista.configuracion ? (
        <Aviso titulo="Configura dónde te pagan">
          {vista.puedeEditar ? <>Antes de dar de alta clientes, captura la CLABE donde recibes y el correo de contacto. <Link href={enEmpresa(empresaId, "/consola/cobros/configuracion")}>Configurar la cobranza</Link></> : "Administración o finanzas deben capturar la CLABE donde la empresa recibe sus cobros."}
        </Aviso>
      ) : null}
      <Deteccion deteccion={vista.deteccion} empresaId={empresaId} puedeEditar={vista.puedeEditar} configurar={vista.puedeEditar && vista.configuracion !== null} />

      <Metricas etiqueta="Resumen de la cobranza">
        <Metrica rotulo="Por cobrar" nota={`${resumen.clientesActivos} ${resumen.clientesActivos === 1 ? "cliente activo" : "clientes activos"}`}>
          <Monto><span data-cifra="por-cobrar" data-centavos={resumen.porCobrar}>{formatoPesos(resumen.porCobrar)}</span></Monto>
        </Metrica>
        <Metrica rotulo={resumen.vencidos === 1 ? "Vencido · 1 cargo" : `Vencido · ${resumen.vencidos} cargos`} nota="Ya pasó su fecha y no ha llegado.">
          <Monto><span data-cifra="vencido" data-centavos={resumen.vencidoCentavos}>{formatoPesos(resumen.vencidoCentavos)}</span></Monto>
        </Metrica>
        <Metrica rotulo="Cobrado este mes" nota="Pagos que llegaron desde el día 1.">
          <Monto><span data-cifra="cobrado-mes" data-centavos={resumen.cobradoMes}>{formatoPesos(resumen.cobradoMes)}</span></Monto>
        </Metrica>
        <Metrica rotulo="Días para cobrar (DSO)" nota="Lo pendiente contra lo emitido en 90 días.">
          <Monto><span data-cifra="dso">{resumen.dso === null ? "Sin datos" : `${resumen.dso} ${resumen.dso === 1 ? "día" : "días"}`}</span></Monto>
        </Metrica>
      </Metricas>

      {resumen.faltaMonto + resumen.porConciliar + resumen.correosFallidos > 0 ? (
        <ul className="cobranza-pendientes" aria-label="Pendientes de la cobranza">
          {resumen.faltaMonto > 0 ? <li><Link href={enlace({ estado: "por_emitir", vista: null })}>{resumen.faltaMonto} {resumen.faltaMonto === 1 ? "cargo variable sin monto" : "cargos variables sin monto"}</Link></li> : null}
          {resumen.porConciliar > 0 ? <li><Link href={enlace({ vista: "conciliar" })}>{resumen.porConciliar} {resumen.porConciliar === 1 ? "pago por conciliar" : "pagos por conciliar"}</Link></li> : null}
          {resumen.correosFallidos > 0 ? <li><span className="cobranza-fallido">{resumen.correosFallidos} {resumen.correosFallidos === 1 ? "correo no salió" : "correos no salieron"}</span></li> : null}
        </ul>
      ) : null}

      <Hoja id="antiguedad" titulo="Antigüedad de lo pendiente" className="flujo-bloque">
        <Antiguedad resumen={resumen} empresaId={empresaId} activa={filtros.cubeta} />
      </Hoja>

      <nav className="segmentado cobranza-pestanas" aria-label="Vistas de la cobranza">
        <Link href={enlace({ vista: null })} aria-current={pestana === "cargos" ? "page" : undefined}>Cargos</Link>
        <Link href={enlace({ vista: "clientes", estado: null, antiguedad: null, q: null })} aria-current={pestana === "clientes" ? "page" : undefined}>Clientes · {vista.clientes.filter((k) => k.estado === "activo").length}</Link>
        <Link href={enlace({ vista: "conciliar", estado: null, antiguedad: null, q: null })} aria-current={pestana === "conciliar" ? "page" : undefined}>Por conciliar · {vista.porConciliar.length}</Link>
      </nav>

      {pestana === "clientes" ? (
        <Hoja id="lista-clientes" titulo="Clientes" className="flujo-bloque">
          {vista.clientes.length === 0 ? (
            <Vacio titulo="Todavía no tienes clientes en cobranza.">{vista.puedeEditar ? <>Da de alta al primero: <Link href={enEmpresa(empresaId, "/consola/cobros/nuevo")}>Nuevo cliente</Link>.</> : undefined}</Vacio>
          ) : (
            <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de clientes en cobranza">
              <table className="tabla flujo-apilada cobranza-tabla-clientes" data-tabla="clientes" role="table">
                <thead role="rowgroup"><tr role="row">
                  <th scope="col" role="columnheader">Cliente</th>
                  <th scope="col" role="columnheader">Plan</th>
                  <th scope="col" role="columnheader" className="derecha">Pendiente</th>
                  <th scope="col" role="columnheader" className="derecha">Vencido</th>
                  <th scope="col" role="columnheader">Próximo vencimiento</th>
                </tr></thead>
                <tbody role="rowgroup">
                  {vista.clientes.map((k) => (
                    <tr key={k.id} role="row" data-cliente={k.id} data-estado={k.estado}>
                      <td role="cell" data-columna="cliente">
                        <Link href={enEmpresa(empresaId, `/consola/cobros/clientes/${k.id}`)}>{k.nombre}</Link>
                        <small>{k.estado === "archivado" ? "Archivado" : k.recordatorios ? k.correos.join(", ") : "Sin recordatorios"}</small>
                      </td>
                      <td role="cell" data-columna="plan" data-etiqueta="Plan">{k.plan ? `${ETIQUETA_PERIODICIDAD[k.plan.periodicidad]} · ${k.plan.tipo === "fijo" && k.plan.montoCentavos ? formatoPesos(k.plan.montoCentavos) : "variable"}${k.plan.estado === "pausado" ? " · en pausa" : k.plan.estado === "cancelado" ? " · cancelado" : ""}` : "Sin plan"}</td>
                      <td role="cell" data-columna="pendiente" data-etiqueta="Pendiente" className="cifra">{formatoPesos(k.pendienteCentavos)}{k.saldoAFavor > 0 ? <small>A favor {formatoPesos(k.saldoAFavor)}</small> : null}</td>
                      <td role="cell" data-columna="vencido" data-etiqueta="Vencido" className={k.vencidoCentavos > 0 ? "cifra cobranza-fallido" : "cifra"}>{formatoPesos(k.vencidoCentavos)}</td>
                      <td role="cell" data-columna="proximo" data-etiqueta="Próximo vencimiento">{k.proximoVencimiento ? fechaConAnio(k.proximoVencimiento) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Hoja>
      ) : pestana === "conciliar" ? (
        <Hoja id="por-conciliar" titulo="Pagos por conciliar" className="flujo-bloque">
          <p className="pista">Lo que llegó y no se aplicó solo: sin identificar, saldo a favor o posible duplicado. Lever nunca adivina; tú decides a qué cargo va.</p>
          <AvisosDeLista>
            <div className="flujo-acciones-fila cobranza-acciones-arriba">
              {vista.puedeEditar ? <><PagoSinCargo clienteId={null} hoy={vista.hoy} /><Link className="boton-texto boton-chico" href={enEmpresa(empresaId, "/consola/cobros/estado-de-cuenta")}>Subir estado de cuenta</Link></> : null}
            </div>
            {vista.porConciliar.length === 0 ? (
              <Vacio titulo="Nada por conciliar.">Cada pago que llegó ya está aplicado a su cargo.</Vacio>
            ) : (
              <ListaPagos pagos={vista.porConciliar} puedeEditar={vista.puedeEditar} opciones={opcionesAplicar} empresaId={empresaId} />
            )}
          </AvisosDeLista>
        </Hoja>
      ) : (
        <Hoja id="lista-cargos" titulo="Cargos" className="flujo-bloque">
          <AvisosDeLista>
            <div className="flujo-filtros">
              <nav className="segmentado" aria-label="Estado">
                {FILTROS.map(([clave, texto]) => <Link key={clave} href={enlace({ estado: clave === "todos" ? null : clave })} aria-current={filtros.estado === clave ? "page" : undefined}>{texto}</Link>)}
              </nav>
              <form method="get" action={enEmpresa(empresaId, "/consola/cobros")} className="cobranza-buscar" role="search">
                {filtros.estado !== "todos" ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
                {filtros.cubeta ? <input type="hidden" name="antiguedad" value={filtros.cubeta} /> : null}
                <label htmlFor="buscar-cargos" className="solo-lector">Buscar por cliente, concepto o referencia</label>
                <input id="buscar-cargos" name="q" type="search" placeholder="Cliente, concepto o referencia" defaultValue={filtros.q ?? ""} maxLength={80} />
                <button type="submit" className="boton-texto boton-chico">Buscar</button>
              </form>
            </div>
            {filtros.cubeta ? <p className="pista">Solo lo de {ETIQUETA_CUBETA[filtros.cubeta].toLowerCase()}. <Link href={enlace({ antiguedad: null })}>Quitar el filtro</Link></p> : null}
            {vista.cargos.filas.length === 0 ? (
              <Vacio titulo={vista.cargos.total === 0 && filtros.estado === "todos" && !filtros.q && !filtros.cubeta ? "Todavía no hay cargos." : "Ningún cargo con estos filtros."}>
                {vista.puedeEditar && filtros.estado === "todos" && !filtros.q ? <>Da de alta a tu primer cliente: <Link href={enEmpresa(empresaId, "/consola/cobros/nuevo")}>Nuevo cliente</Link>.</> : undefined}
              </Vacio>
            ) : (
              <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de cargos por cobrar">
                <table className="tabla flujo-apilada flujo-tabla-cobros cobranza-tabla-cargos" data-tabla="cargos" role="table">
                  <thead role="rowgroup"><tr role="row">
                    <th scope="col" role="columnheader">Cliente</th>
                    <th scope="col" role="columnheader">Concepto</th>
                    <th scope="col" role="columnheader">Vence</th>
                    <th scope="col" role="columnheader" className="derecha">Saldo</th>
                    <th scope="col" role="columnheader">Estado</th>
                    {vista.puedeEditar ? <th scope="col" role="columnheader"><span className="solo-lector">Acciones</span></th> : null}
                  </tr></thead>
                  <tbody role="rowgroup">
                    {vista.cargos.filas.map((f) => (
                      <tr key={`${f.tipo}-${f.id}`} role="row" data-cargo={f.id} data-estado={f.estado} data-tipo={f.tipo}>
                        <td role="cell" data-columna="cliente">
                          {f.clienteId ? <Link href={enEmpresa(empresaId, `/consola/cobros/clientes/${f.clienteId}`)}>{f.cliente}</Link> : f.cliente}
                          {f.rfc ? <small className="mono">{f.rfc}</small> : null}
                        </td>
                        <td role="cell" data-columna="concepto">
                          {f.concepto}
                          <small>{f.tipo === "cobro_suelto" ? "Cobro suelto" : f.periodicidad ? ETIQUETA_PERIODICIDAD[f.periodicidad] : "Cargo único"}{f.referencia ? ` · ref ${f.referencia}` : ""}</small>
                        </td>
                        <td role="cell" data-columna="fecha" data-etiqueta="Vence">{fechaCorta(f.vencimiento)}<small><UltimoCorreo correo={f.ultimoCorreo} /></small></td>
                        <td role="cell" data-columna="monto" className="cifra">
                          {f.montoCentavos === null ? "—" : formatoPesos(f.montoCentavos - f.pagadoCentavos)}
                          {f.montoCentavos !== null && f.pagadoCentavos > 0 && f.estado === "emitido" ? <small>de {formatoPesos(f.montoCentavos)}</small> : null}
                        </td>
                        <td role="cell" data-columna="estado"><EstadoCargo fila={f} hoy={vista.hoy} /></td>
                        {vista.puedeEditar ? (
                          <td role="cell" data-columna="acciones">
                            {f.tipo === "cargo" ? <AccionesCargo cargo={f} hoy={vista.hoy} demostracion={vista.demostracion} />
                              : f.estado === "emitido" && f.montoCentavos !== null ? <ResolverCobro id={f.id} cliente={f.cliente} montoCentavos={f.montoCentavos} hoy={vista.hoy} /> : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {paginas > 1 ? (
              <nav className="cobranza-paginas" aria-label="Páginas">
                {filtros.pagina > 1 ? <Link href={enlace({ pagina: String(filtros.pagina - 1) })}>Anterior</Link> : null}
                <span>Página {filtros.pagina} de {paginas}</span>
                {filtros.pagina < paginas ? <Link href={enlace({ pagina: String(filtros.pagina + 1) })}>Siguiente</Link> : null}
              </nav>
            ) : null}
          </AvisosDeLista>
        </Hoja>
      )}

      {vista.puedeEditar ? (
        <>
          <h2 className="cobranza-subtitulo">Cobro suelto, sin cliente dado de alta</h2>
          <p className="pista">Para registrar un cobro esperado que no vas a mandar desde Lever. Cuenta en el flujo de caja.</p>
          <Rejilla
            principal={<Hoja id="nuevo-cobro" titulo="Registrar un cobro" className="flujo-bloque"><FormularioCobro hoy={vista.hoy} altaId={vista.altaIds.cobro} /></Hoja>}
            lateral={<Hoja id="cobro-xml" titulo="Desde una factura emitida" className="flujo-bloque"><FormularioCobroXml hoy={vista.hoy} altaId={vista.altaIds.xml} /></Hoja>}
          />
        </>
      ) : (
        <NotaRegla>Tu rol puede ver la cobranza. La cambian administración o finanzas.</NotaRegla>
      )}
    </>
  );
}

const FUENTE_PAGO: Record<PagoVista["fuente"], string> = { manual: "Registrado a mano", demo: "Simulado", fintoc: "Aviso del banco (Fintoc)", estado_cuenta: "Estado de cuenta" };

function ListaPagos({ pagos, puedeEditar, opciones, empresaId }: { pagos: readonly PagoVista[]; puedeEditar: boolean; opciones: { id: string; texto: string; clienteId: string; saldo: number }[]; empresaId: string }) {
  const fuente = FUENTE_PAGO;
  return (
    <ul className="cobranza-pagos" data-lista="pagos">
      {pagos.map((p) => {
        const libre = p.montoCentavos - p.aplicadoCentavos;
        const propias = opciones.filter((o) => !p.clienteId || o.clienteId === p.clienteId);
        const sugeridas = [...propias.filter((o) => o.saldo === libre), ...propias.filter((o) => o.saldo !== libre)];
        const texto = `${formatoPesos(p.montoCentavos)} del ${fechaConAnio(p.recibidoEl)}`;
        return (
          <li key={p.id} data-pago={p.id} data-estado={p.estado}>
            <div className="cobranza-pago-cabeza">
              <strong className="cifra">{formatoPesos(p.montoCentavos)}</strong>
              <span>{p.cliente ? p.clienteId ? <Link href={enEmpresa(empresaId, `/consola/cobros/clientes/${p.clienteId}`)}>{p.cliente}</Link> : p.cliente : "Sin identificar"}</span>
              {p.posibleDuplicado ? <Insignia tono="aviso">Posible duplicado</Insignia> : null}
              {p.deOtroCliente ? <span data-marca="otro-cliente"><Insignia tono="aviso">Pagado desde la cuenta de otro cliente</Insignia></span> : null}
              {p.estado === "anulado" ? <Insignia>Anulado</Insignia> : p.estado === "devuelto" ? <Insignia>Devuelto al ordenante</Insignia> : p.estado === "abierto" ? <Insignia tono="aviso">{p.aplicadoCentavos > 0 ? `Saldo a favor ${formatoPesos(libre)}` : "Sin aplicar"}</Insignia> : <Insignia tono="sello">Aplicado</Insignia>}
            </div>
            <p className="pista">
              {fuente[p.fuente]} · llegó el {fechaConAnio(p.recibidoEl)}{p.claveRastreo ? <> · rastreo <span className="mono">{p.claveRastreo}</span></> : null}{p.referencia ? ` · ref ${p.referencia}` : ""}
              {p.documentoId ? <> · <a href={enEmpresa(empresaId, `/consola/cobros/comprobante/${p.documentoId}`)}>Comprobante</a></> : null}
              {p.motivo ? ` · ${p.motivo}` : ""}
            </p>
            {p.parecido ? (
              <p className="pista" data-parecido={p.parecido.id}>
                Parece el mismo depósito que: {fuente[p.parecido.fuente]} del {fechaConAnio(p.parecido.recibidoEl)} por {formatoPesos(p.parecido.montoCentavos)}
                {p.parecido.cliente ? ` · ${p.parecido.cliente}` : ""}{p.parecido.estado === "aplicado" ? " · ya aplicado" : ""}. Aplícalo solo si de verdad llegaron dos depósitos; si es el mismo, descártalo.
              </p>
            ) : null}
            {p.aplicaciones.length > 0 ? (
              <ul className="cobranza-aplicaciones">
                {p.aplicaciones.map((a) => (
                  <li key={a.id}>
                    <span>{formatoPesos(a.montoCentavos)} a «{a.concepto}»{a.revertida ? " · revertida" : ""}</span>
                    {puedeEditar && !a.revertida && p.estado !== "anulado" && p.estado !== "devuelto" ? <RevertirAplicacion aplicacionId={a.id} texto={`${formatoPesos(a.montoCentavos)} a «${a.concepto}»`} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {puedeEditar && p.estado === "abierto" ? (
              <div className="flujo-acciones-fila cobranza-acciones-pago">
                <AplicarPago pagoId={p.id} opciones={sugeridas.slice(0, 50)} />
                {(p.fuente === "manual" || p.posibleDuplicado) && p.aplicadoCentavos === 0 ? <AnularPago pagoId={p.id} texto={texto} descartar={p.posibleDuplicado} /> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// Ficha del cliente ------------------------------------------------------------------

const ACCION_HISTORIAL: Record<string, string> = {
  alta_cliente_cobranza: "Alta del cliente",
  editar_cliente_cobranza: "Datos del cliente editados",
  archivar_cliente_cobranza: "Cliente archivado",
  recordatorios_cliente_cobranza: "Recordatorios cambiados",
  alta_plan_cobranza: "Alta del plan",
  editar_plan_cobranza: "Plan editado",
  pausar_plan_cobranza: "Plan en pausa",
  reanudar_plan_cobranza: "Plan reanudado",
  cancelar_plan_cobranza: "Plan cancelado",
  generar_cargo: "Cargo generado",
  emitir_cargo: "Monto capturado y cargo emitido",
  cancelar_cargo: "Cargo cancelado",
  abono_cargo: "Abono al cargo",
  registrar_pago_cobranza: "Pago recibido",
  anular_pago_cobranza: "Pago anulado",
  descartar_duplicado_cobranza: "Posible duplicado descartado",
  aplicacion_cobranza: "Pago aplicado",
  correo_cobranza: "Correo",
  clabe_cliente_cobranza: "CLABE propia asignada",
};

/** Asientos internos que repiten lo que ya dice otro renglón del historial (el saldo del pago tras cada abono). */
const HISTORIAL_OCULTO = new Set(["saldo_pago_cobranza"]);

const AVISO_ALTA: Record<string, string> = {
  enviado: "El cliente quedó dado de alta y el correo de cobro ya salió con la CLABE y la referencia.",
  simulado: "El cliente quedó dado de alta. Empresa de demostración: el correo quedó simulado y no salió.",
  programado: "El cliente quedó dado de alta. El primer cobro sale automáticamente unos días antes del vencimiento.",
  manual: "El cliente quedó dado de alta. El envío automático está apagado: manda el cobro desde la lista de cargos.",
  fallido: "El cliente quedó dado de alta, pero el correo no salió. La tarea diaria lo vuelve a intentar.",
  tope: "El cliente quedó dado de alta. Llegaste al tope diario de correos: el cobro sale en la siguiente corrida.",
};

export function VistaClientePagina({ vista, empresaId, alta }: { vista: VistaCliente | null; empresaId: string; alta?: string }) {
  if (!vista) return <SinLectura titulo="Cliente" />;
  const { detalle } = vista;
  const k = detalle.cliente;
  const vivo = detalle.planes.find((p) => p.estado !== "cancelado") ?? null;
  const editable = vista.puedeEditar && k.estado === "activo";
  const opciones = detalle.cargos.filter((c) => c.estado === "emitido").map((c) => ({ id: c.id, texto: `${c.concepto} · ${formatoPesos((c.montoCentavos ?? 0) - c.pagadoCentavos)} · ref ${c.referencia ?? ""}`, clienteId: k.id, saldo: (c.montoCentavos ?? 0) - c.pagadoCentavos }));
  return (
    <>
      <header className="pagina-cabeza cobranza-cabeza-cliente">
        <p className="kicker"><Link href={enEmpresa(empresaId, "/consola/cobros?vista=clientes")}>Cobranza · Clientes</Link></p>
        <h1>{k.nombre}</h1>
        <p className="pista">
          {k.rfc ? <span className="mono">{k.rfc} · </span> : null}{k.correos.join(", ")}
          {" · "}{k.estado === "archivado" ? "Archivado" : k.recordatorios ? "Con recordatorios" : k.recordatoriosPor === "pagador" ? "El cliente pidió no recibir recordatorios" : "Recordatorios apagados"}
        </p>
        {editable ? (
          <AvisosDeLista>
            <div className="flujo-acciones-fila cobranza-acciones-arriba">
              <EditarCliente cliente={k} />
              <Recordatorios clienteId={k.id} activos={k.recordatorios} porPagador={k.recordatoriosPor === "pagador"} />
              <ArchivarCliente clienteId={k.id} nombre={k.nombre} />
            </div>
          </AvisosDeLista>
        ) : null}
      </header>
      {alta && AVISO_ALTA[alta] ? <Aviso tono="asentado" titulo="Quedó asentado">{AVISO_ALTA[alta]}</Aviso> : null}

      <AvisosDeLista>
        <Metricas etiqueta={`Resumen de ${k.nombre}`}>
          <Metrica rotulo="Pendiente"><Monto><span data-cifra="pendiente" data-centavos={k.pendienteCentavos}>{formatoPesos(k.pendienteCentavos)}</span></Monto></Metrica>
          <Metrica rotulo="Vencido"><Monto><span data-cifra="vencido" data-centavos={k.vencidoCentavos}>{formatoPesos(k.vencidoCentavos)}</span></Monto></Metrica>
          <Metrica rotulo="Saldo a favor"><Monto><span data-cifra="a-favor" data-centavos={k.saldoAFavor}>{formatoPesos(k.saldoAFavor)}</span></Monto></Metrica>
          <Metrica rotulo="Próximo vencimiento" nota={k.proximoVencimiento ? k.proximoVencimiento.slice(0, 4) : undefined}><Monto>{k.proximoVencimiento ? fechaCorta(k.proximoVencimiento) : "—"}</Monto></Metrica>
        </Metricas>

        <Rejilla
          principal={
            <>
              <Hoja id="plan" titulo="Plan de cobro" className="flujo-bloque">
                {vivo ? (
                  <>
                    <p className="frase" data-plan={vivo.id}>
                      {vivo.concepto}: {vivo.tipo === "fijo" && vivo.montoCentavos ? formatoPesos(vivo.montoCentavos) : "monto variable"}, {ETIQUETA_PERIODICIDAD[vivo.periodicidad].toLowerCase()}, desde el {fechaConAnio(vivo.primerVencimiento)}{vivo.fin ? ` hasta el ${fechaConAnio(vivo.fin)}` : ""}.
                      {vivo.estado === "pausado" ? " En pausa." : ""}
                    </p>
                    {vista.proximos.length > 0 ? (
                      <ol className="cobranza-calendario" data-calendario="plan" aria-label="Próximos vencimientos">
                        {vista.proximos.map((p) => (
                          <li key={p.vencimiento} data-generado={p.generado || undefined}><span>{fechaCorta(p.vencimiento)}</span><span className="pista">{p.generado ? "Cargo generado" : "Programado"}</span></li>
                        ))}
                      </ol>
                    ) : null}
                    {editable ? <AccionesPlan plan={vivo} /> : null}
                  </>
                ) : (
                  <Vacio titulo="Sin plan vivo.">{editable ? "Agrega un plan o un cargo único." : undefined}</Vacio>
                )}
                {editable ? <NuevoCobroDeCliente clienteId={k.id} hoy={vista.hoy} altaPlan={vista.altaIds.plan} altaCargo={vista.altaIds.cargo} /> : null}
                {detalle.planes.filter((p) => p.estado === "cancelado").map((p) => (
                  <p key={p.id} className="pista">Plan cancelado: {p.concepto} ({ETIQUETA_PERIODICIDAD[p.periodicidad].toLowerCase()}){p.motivo ? ` · ${p.motivo}` : ""}</p>
                ))}
              </Hoja>

              <Hoja id="cargos-cliente" titulo="Cargos" className="flujo-bloque">
                {detalle.cargos.length === 0 ? <Vacio titulo="Todavía no hay cargos.">El primero se genera unos días antes de su vencimiento.</Vacio> : (
                  <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de cargos del cliente">
                    <table className="tabla flujo-apilada flujo-tabla-cobros" data-tabla="cargos-cliente" role="table">
                      <thead role="rowgroup"><tr role="row">
                        <th scope="col" role="columnheader">Concepto</th>
                        <th scope="col" role="columnheader">Vence</th>
                        <th scope="col" role="columnheader" className="derecha">Saldo</th>
                        <th scope="col" role="columnheader">Estado</th>
                        {editable ? <th scope="col" role="columnheader"><span className="solo-lector">Acciones</span></th> : null}
                      </tr></thead>
                      <tbody role="rowgroup">
                        {detalle.cargos.map((c) => (
                          <tr key={c.id} role="row" data-cargo={c.id} data-estado={c.estado}>
                            <td role="cell" data-columna="concepto">{c.concepto}<small>ref <span className="mono">{c.referencia}</span>{c.correos.length > 0 ? ` · ${c.correos.length} ${c.correos.length === 1 ? "correo" : "correos"}` : ""}</small></td>
                            <td role="cell" data-columna="fecha" data-etiqueta="Vence">{fechaCorta(c.vencimiento)}</td>
                            <td role="cell" data-columna="monto" className="cifra">{c.montoCentavos === null ? "—" : formatoPesos(c.montoCentavos - c.pagadoCentavos)}</td>
                            <td role="cell" data-columna="estado"><EstadoCargo fila={c} hoy={vista.hoy} /></td>
                            {editable ? <td role="cell" data-columna="acciones"><AccionesCargo cargo={c} hoy={vista.hoy} demostracion={vista.demostracion} /></td> : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Hoja>

              <Hoja id="pagos-cliente" titulo="Pagos recibidos" className="flujo-bloque">
                {editable ? <div className="flujo-acciones-fila cobranza-acciones-arriba"><PagoSinCargo clienteId={k.id} hoy={vista.hoy} /></div> : null}
                {detalle.pagos.length === 0 ? <Vacio titulo="Todavía no llega ningún pago." /> : <ListaPagos pagos={detalle.pagos} puedeEditar={editable} opciones={opciones} empresaId={empresaId} />}
              </Hoja>
            </>
          }
          lateral={
            <>
              <Hoja id="donde-paga" titulo="Dónde te paga" className="flujo-bloque">
                {vista.clabePropia ? (
                  <>
                    <EtiquetaMono nombre="CLABE propia">{clabeVisible(vista.clabePropia)}</EtiquetaMono>
                    <p className="pista">Solo este cliente deposita en esta CLABE: cada depósito se identifica y se aplica solo.</p>
                  </>
                ) : vista.configuracion ? (
                  <>
                    <EtiquetaMono nombre="CLABE">{clabeVisible(vista.configuracion.clabe)}</EtiquetaMono>
                    <p className="pista">{vista.configuracion.banco ?? "Banco"} · {vista.configuracion.beneficiario}. Cada cargo lleva su referencia de 7 dígitos.</p>
                    {vista.deteccion === "pronto" ? <p className="pista">La CLABE propia por cliente: disponible pronto.</p> : null}
                  </>
                ) : <p className="pista">Sin configurar.</p>}
              </Hoja>
              <Hoja id="historial" titulo="Historial" className="flujo-bloque">
                {detalle.historial.length === 0 ? <Vacio titulo="Sin movimientos." /> : (
                  <ol className="cobranza-historial">
                    {detalle.historial.filter((e) => !HISTORIAL_OCULTO.has(e.accion)).map((e, i) => (
                      <li key={`${e.en}-${i}`}>
                        <span>{ACCION_HISTORIAL[e.accion] ?? e.accion}{e.accion === "correo_cobranza" && e.cambio && typeof e.cambio.tipo === "string" ? ` de ${(ETIQUETA_TIPO as Record<string, string>)[e.cambio.tipo]?.toLowerCase() ?? "cobro"} · ${String(e.cambio.estado ?? "")}` : ""}</span>
                        <small className="pista">{fechaCorta(e.en.slice(0, 10))}{e.autor ? ` · ${e.autor}` : " · Lever"}{e.motivo ? ` · ${e.motivo}` : ""}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </Hoja>
            </>
          }
        />
      </AvisosDeLista>
    </>
  );
}

// Alta y configuración ---------------------------------------------------------------

export function VistaNuevoPagina({ vista, empresaId }: { vista: VistaNuevo | null; empresaId: string }) {
  if (!vista) return <SinLectura titulo="Nuevo cliente" />;
  return (
    <>
      <h1 className="solo-lector">Nuevo cliente</h1>
      {!vista.puedeEditar ? <NotaRegla>Tu rol puede ver la cobranza. Dan de alta clientes administración o finanzas.</NotaRegla> : !vista.configuracion ? (
        <Aviso titulo="Primero configura dónde te pagan">
          El correo de cobro lleva tu CLABE y tu contacto. <Link href={enEmpresa(empresaId, "/consola/cobros/configuracion")}>Configurar la cobranza</Link>
        </Aviso>
      ) : (
        <Hoja id="alta" titulo="Dar de alta a un cliente" className="flujo-bloque">
          <p className="pista">{vista.calendario}{vista.deteccion === "fintoc" ? " Al darlo de alta recibe su CLABE propia." : ""}</p>
          <FormularioAlta altaId={vista.altaId} hoy={vista.hoy} emitirDiasAntes={vista.configuracion.emitirDiasAntes} />
        </Hoja>
      )}
    </>
  );
}

export function VistaConfiguracionPagina({ vista, empresaId }: { vista: VistaConfiguracion | null; empresaId: string }) {
  if (!vista) return <SinLectura titulo="Configuración de cobranza" />;
  const c = vista.configuracion;
  return (
    <>
      <h1 className="solo-lector">Configuración de cobranza</h1>
      <Rejilla
        principal={vista.puedeEditar ? (
          <Hoja id="configuracion" titulo="Dónde te pagan y cuándo se cobra" className="flujo-bloque">
            <FormularioConfiguracion inicial={{
              clabe: c?.clabe ?? "", beneficiario: c?.beneficiario ?? vista.razonSocial, correoContacto: c?.correoContacto ?? "",
              emitirDiasAntes: c?.emitirDiasAntes ?? 7, antesDias: c?.antesDias ?? 3, avisoElDia: c?.avisoElDia ?? true,
              despuesCadaDias: c?.despuesCadaDias ?? 7, despuesTope: c?.despuesTope ?? 3, envioAutomatico: c?.envioAutomatico ?? true,
            }} />
          </Hoja>
        ) : (
          <Hoja id="configuracion" titulo="Dónde te pagan" className="flujo-bloque">
            {c ? <><EtiquetaMono nombre="CLABE">{clabeVisible(c.clabe)}</EtiquetaMono><p className="pista">{c.beneficiario} · {textoCalendario(c)}</p></> : <Vacio titulo="Sin configurar." />}
            <NotaRegla>La cambian administración o finanzas.</NotaRegla>
          </Hoja>
        )}
        lateral={
          <Hoja id="deteccion" titulo="Cómo se detecta el pago" className="flujo-bloque">
            <Deteccion deteccion={vista.deteccion} empresaId={empresaId} puedeEditar={vista.puedeEditar} />
            <p className="pista">El dinero va directo a la cuenta de {vista.razonSocial}. Lever no lo recibe ni lo guarda: manda el cobro, recuerda y concilia.</p>
          </Hoja>
        }
      />
    </>
  );
}

// Estado de cuenta -------------------------------------------------------------------

export function VistaEstadoDeCuentaPagina({ vista, empresaId, nuevos, repetidos }: { vista: VistaEstadoDeCuenta | null; empresaId: string; nuevos?: string; repetidos?: string }) {
  if (!vista) return <SinLectura titulo="Estado de cuenta" />;
  const nombreBanco = (clave: string) => BANCOS.find((b) => b.clave === clave)?.nombre ?? clave;
  const actual = vista.actual;
  const pendientes = actual?.renglones.filter((r) => r.estado === "pendiente") ?? [];
  return (
    <>
      <h1 className="solo-lector">Estado de cuenta</h1>
      {nuevos ? <Aviso tono="asentado" titulo="El archivo se leyó">{`${nuevos} ${nuevos === "1" ? "abono nuevo" : "abonos nuevos"}${repetidos && repetidos !== "0" ? ` y ${repetidos} que ya estaban (no se duplicaron)` : ""}. Revisa las propuestas y confirma.`}</Aviso> : null}
      {vista.puedeEditar ? (
        <Hoja id="subir" titulo="Subir el estado de cuenta" className="flujo-bloque">
          <p className="pista">Descarga los movimientos de tu banco en CSV o Excel y súbelos. Lever lee los abonos, los empata con tus cargos por su referencia y te propone qué aplicar. Lo que no sea seguro queda en «Por conciliar». Volver a subir el mismo archivo no duplica nada.</p>
          <SubirEstadoDeCuenta bancosConEmpate={vista.bancosConEmpate} />
        </Hoja>
      ) : <NotaRegla>Suben estados de cuenta administración o finanzas.</NotaRegla>}

      {actual ? (
        <Hoja id="propuestas" titulo={`${nombreBanco(actual.banco)} · ${actual.nombreArchivo}`} className="flujo-bloque">
          <p className="pista cobranza-resumen-importacion">{actual.abonos} {actual.abonos === 1 ? "abono" : "abonos"} en el archivo, {actual.nuevos} {actual.nuevos === 1 ? "nuevo" : "nuevos"}. {actual.estado === "confirmada" ? "Confirmada." : "Por confirmar."}</p>
          {vista.puedeEditar ? (
            <ConfirmarEstadoDeCuenta importacionId={actual.id} confirmable={actual.estado === "propuesta" && pendientes.length > 0}>
              <TablaPropuestas renglones={actual.renglones} editable={actual.estado === "propuesta"} />
            </ConfirmarEstadoDeCuenta>
          ) : <TablaPropuestas renglones={actual.renglones} editable={false} />}
        </Hoja>
      ) : null}

      {vista.importaciones.length > 0 ? (
        <Hoja id="importaciones" titulo="Importaciones" className="flujo-bloque">
          <ul className="cobranza-importaciones">
            {vista.importaciones.map((i) => (
              <li key={i.id}>
                <Link href={enEmpresa(empresaId, `/consola/cobros/estado-de-cuenta?importacion=${i.id}`)} aria-current={actual?.id === i.id ? "true" : undefined}>{nombreBanco(i.banco)} · {i.nombreArchivo}</Link>
                <small className="pista">{i.nuevos} {i.nuevos === 1 ? "abono nuevo" : "abonos nuevos"} · {i.estado === "confirmada" ? "confirmada" : "por confirmar"}{i.subidoPor ? ` · ${i.subidoPor}` : ""}</small>
              </li>
            ))}
          </ul>
        </Hoja>
      ) : null}
    </>
  );
}

function TablaPropuestas({ renglones, editable }: { renglones: NonNullable<VistaEstadoDeCuenta["actual"]>["renglones"]; editable: boolean }) {
  const estado: Record<string, ReactNode> = {
    aplicado: <Insignia tono="sello">Aplicado</Insignia>,
    por_conciliar: <Insignia tono="aviso">Por conciliar</Insignia>,
    ya_registrado: <Insignia>Ya estaba registrado</Insignia>,
    descartado: <Insignia>Descartado</Insignia>,
  };
  return (
    <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de renglones del estado de cuenta">
      <table className="tabla flujo-apilada cobranza-tabla-propuestas" data-tabla="propuestas" role="table">
        <thead role="rowgroup"><tr role="row">
          <th scope="col" role="columnheader">Fecha</th>
          <th scope="col" role="columnheader">Concepto</th>
          <th scope="col" role="columnheader" className="derecha">Abono</th>
          <th scope="col" role="columnheader">Propuesta</th>
          {editable ? <th scope="col" role="columnheader">Descartar</th> : null}
        </tr></thead>
        <tbody role="rowgroup">
          {renglones.map((r) => (
            <tr key={r.id} role="row" data-renglon={r.id} data-estado={r.estado} data-propuesta={r.propuesta?.tipo}>
              <td role="cell" data-columna="fecha" data-etiqueta="Fecha">{fechaCorta(r.fecha)}</td>
              <td role="cell" data-columna="concepto">{r.concepto ?? "—"}<small>{r.referencia ? `ref ${r.referencia}` : ""}{r.rastreo ? `${r.referencia ? " · " : ""}rastreo ${r.rastreo}` : ""}</small></td>
              <td role="cell" data-columna="monto" className="cifra">{formatoPesos(r.montoCentavos)}</td>
              <td role="cell" data-columna="propuesta">
                {r.estado !== "pendiente" ? estado[r.estado] : r.propuesta?.tipo === "aplicar" ? (
                  <span>Aplicar a <strong>{r.propuesta.cliente}</strong> · {r.propuesta.concepto}{r.propuesta.montoCentavos < r.montoCentavos ? ` (${formatoPesos(r.propuesta.montoCentavos)}; el resto queda a favor)` : ""}</span>
                ) : r.propuesta?.tipo === "ya_registrado" ? (
                  <span>Ya está registrado con esa clave de rastreo: no se vuelve a contar.</span>
                ) : r.propuesta?.tipo === "por_conciliar" ? (
                  <span>
                    A «Por conciliar»{r.propuesta.cliente ? ` (de ${r.propuesta.cliente})` : ""}.
                    {r.propuesta.parecido ? (
                      <small data-parecido>
                        Posible duplicado: ya está {FUENTE_PAGO[r.propuesta.parecido.fuente].toLowerCase()} del {fechaCorta(r.propuesta.parecido.recibidoEl)} por {formatoPesos(r.propuesta.parecido.montoCentavos)}{r.propuesta.parecido.cliente ? ` (${r.propuesta.parecido.cliente})` : ""}. No se aplica solo.
                      </small>
                    ) : null}
                    {r.propuesta.sugerencias.length > 0 ? <small>Mismo monto: {r.propuesta.sugerencias.map((s) => `${s.cliente} · ${s.concepto}`).join("; ")}</small> : <small>Sin cargos del mismo monto.</small>}
                  </span>
                ) : "—"}
              </td>
              {editable ? (
                <td role="cell" data-columna="descartar">
                  {r.estado === "pendiente" ? (
                    <label className="cobranza-casilla"><input type="checkbox" name="descartar" value={r.id} /> <span className="solo-lector">Descartar el abono de {formatoPesos(r.montoCentavos)} del {fechaCorta(r.fecha)}</span><span aria-hidden="true">No es de un cliente</span></label>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
