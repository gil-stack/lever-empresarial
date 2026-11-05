import Link from "next/link";

import { DecisionPago, FormularioContrato } from "./acciones-pago";
import { FormularioCambio } from "./formulario-cambio";
import { CabezaPagina, EtiquetaMono, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { clabeVisible } from "@/dominio/clabe";
import { institucionTradicional, FRASE_INSTITUCION_PENDIENTE } from "@/dominio/clabe-proveedor";
import { ETIQUETA_ESTADO, ESTADOS_PAGO, fechaLegible, tonoEstado } from "@/dominio/pagos-proveedores";
import { horaEnMexico } from "@/dominio/reloj";
import { enEmpresa } from "@/nucleo/rutas";
import type { LecturaPagosProveedores } from "@/server/pagos-proveedores";
import type { PagoVista, ProveedorPago } from "@/dominio/pagos-vistas";
import type { LecturaClabes } from "@/server/proveedores/tipos";

export type VistaProveedores = "pagos" | "proveedores" | "agenda";

export function MesaProveedores({
  lectura,
  historial,
  empresaId,
  personaId,
  hoy,
  vista,
  q,
  estado,
  pagoId,
  proveedorId,
  puedeSolicitar,
  puedeLiberar,
  puedeAdministrar,
}: {
  lectura: LecturaPagosProveedores;
  historial: LecturaClabes;
  empresaId: string;
  personaId: string;
  hoy: string;
  vista: VistaProveedores;
  q: string;
  estado: string;
  pagoId?: string;
  proveedorId?: string;
  puedeSolicitar: boolean;
  puedeLiberar: boolean;
  puedeAdministrar: boolean;
}) {
  const pago = pagoId ? lectura.pagos.find((actual) => actual.id === pagoId) : undefined;
  const proveedor = proveedorId ? lectura.proveedores.find((actual) => actual.id === proveedorId) : undefined;
  const detalle = pago || proveedor;
  const href = (ruta: string) => enEmpresa(empresaId, ruta);
  const base = `/consola/proveedores?vista=${vista}${q ? `&q=${encodeURIComponent(q)}` : ""}${estado ? `&estado=${estado}` : ""}`;

  return (
    <>
      <CabezaPagina kicker="Cuentas por pagar" titulo="Pagos a proveedores">
        <p className="lede">Facturas, documentos y autorizaciones en un solo lugar. La autorización deja el pago listo; no mueve dinero.</p>
        <div className="acciones cabeza-acciones">
          {puedeSolicitar ? <Link className="boton" href={href("/consola/proveedores/nuevo")}>Nuevo pago <span aria-hidden="true">↗</span></Link> : null}
          {puedeAdministrar ? <Link className="boton-secundario" href={href("/consola/proveedores/nuevo-proveedor")}>Alta de proveedor</Link> : null}
        </div>
      </CabezaPagina>

      <section className="pagos-metricas" aria-label="Resumen de cuentas por pagar">
        <Metrica titulo="Por vencer" detalle="Próximos 7 días" valor={lectura.metricas.porVencer} />
        <Metrica titulo="Vencido" detalle="Requiere seguimiento" valor={lectura.metricas.vencidos} alerta={lectura.metricas.vencidos.cantidad > 0} />
        <Metrica titulo="Por autorizar" detalle="En revisión" valor={lectura.metricas.porAutorizar} />
        <Metrica titulo="Listo para pagar" detalle="Sin envío bancario" valor={lectura.metricas.listos} acento />
      </section>

      <div className="proveedores-tabs" role="navigation" aria-label="Espacios de proveedores">
        {(["pagos", "proveedores", "agenda"] as const).map((actual) => (
          <Link key={actual} href={href(`/consola/proveedores?vista=${actual}`)} aria-current={vista === actual ? "page" : undefined}>
            {actual === "pagos" ? "Pagos" : actual === "proveedores" ? "Proveedores" : "Agenda"}
            <span>{actual === "pagos" ? lectura.metricas.porAutorizar.cantidad + lectura.metricas.listos.cantidad : actual === "proveedores" ? lectura.proveedores.length : ""}</span>
          </Link>
        ))}
      </div>

      <div className={detalle ? "mesa-proveedores con-detalle" : "mesa-proveedores"}>
        <div className="mesa-principal">
          <section className="bandeja-pagos" aria-label={`Vista de ${vista}`}>
            <div className="bandeja-herramientas">
              <form className="buscador-pagos" action={href("/consola/proveedores")}>
                <input type="hidden" name="vista" value={vista} />
                <label className="solo-lector" htmlFor="buscar-pagos">Buscar</label>
                <span aria-hidden="true">⌕</span>
                <input id="buscar-pagos" name="q" defaultValue={q} placeholder={vista === "proveedores" ? "Buscar por razón social o RFC" : "Buscar proveedor, factura o UUID"} />
                {vista === "pagos" ? (
                  <select name="estado" defaultValue={estado} aria-label="Filtrar por estado">
                    <option value="">Todos los estados</option>
                    {ESTADOS_PAGO.map((actual) => <option key={actual} value={actual}>{ETIQUETA_ESTADO[actual]}</option>)}
                  </select>
                ) : null}
                <button type="submit" className="boton-filtro">Filtrar</button>
                {q || estado ? <Link href={href(`/consola/proveedores?vista=${vista}`)} className="limpiar-filtro">Limpiar</Link> : null}
              </form>
            </div>
            {vista === "pagos" ? <TablaPagos pagos={lectura.pagos} base={base} href={href} hoy={hoy} /> : null}
            {vista === "proveedores" ? <TablaProveedores proveedores={lectura.proveedores} pagos={lectura.pagos} base={base} href={href} /> : null}
            {vista === "agenda" ? <Agenda pagos={lectura.pagos} base={base} href={href} hoy={hoy} /> : null}
            <div className="bandeja-pie">
              <span>{vista === "pagos" ? `${lectura.pagos.length} operaciones en esta página` : vista === "proveedores" ? `${lectura.proveedores.length} proveedores` : "Agenda ordenada por fecha prevista"}</span>
              <div>
                {lectura.pagina > 1 ? <Link href={href(`${base}&pagina=${lectura.pagina - 1}`)}>Anterior</Link> : null}
                {lectura.hayMas ? <Link href={href(`${base}&pagina=${lectura.pagina + 1}`)}>Siguiente</Link> : null}
              </div>
            </div>
          </section>
          {!detalle ? <Actividad lectura={lectura} /> : null}
        </div>
        {pago ? <DetallePago pago={pago} lectura={lectura} empresaId={empresaId} personaId={personaId} cerrar={base} puedeSolicitar={puedeSolicitar} puedeLiberar={puedeLiberar} /> : null}
        {proveedor ? <DetalleProveedor proveedor={proveedor} lectura={lectura} historial={historial} empresaId={empresaId} cerrar={base} puedeAdministrar={puedeAdministrar} /> : null}
      </div>
    </>
  );
}

function Metrica({ titulo, detalle, valor, alerta = false, acento = false }: { titulo: string; detalle: string; valor: { cantidad: number; centavos: number }; alerta?: boolean; acento?: boolean }) {
  return (
    <article className={`pago-metrica${alerta ? " alerta" : ""}${acento ? " acento" : ""}`}>
      <div><p>{titulo}</p><span>{valor.cantidad} {valor.cantidad === 1 ? "operación" : "operaciones"}</span></div>
      <strong>{formatoPesos(valor.centavos)}</strong><small>{detalle}</small>
    </article>
  );
}

function TablaPagos({ pagos, base, href, hoy }: { pagos: PagoVista[]; base: string; href: (ruta: string) => string; hoy: string }) {
  if (pagos.length === 0) return <Vacio titulo="No hay pagos en esta vista">Cambia los filtros o registra una factura para iniciar el recorrido de autorización.</Vacio>;
  return (
    <div className="tabla-scroll"><table className="tabla-pagos"><thead><tr><th>Proveedor / referencia</th><th>Importe</th><th>Vencimiento</th><th>Fecha prevista</th><th>Estado</th><th><span className="solo-lector">Abrir</span></th></tr></thead>
      <tbody>{pagos.map((pago) => <tr key={pago.id}>
        <td><Link className="celda-proveedor" href={href(`${base}&pago=${pago.id}`)}><strong>{pago.proveedor}</strong><span>{pago.referencia}{pago.origen === "excepcion" ? " · Excepción" : ""}</span></Link></td>
        <td className="celda-monto">{formatoPesos(pago.totalCentavos)}</td>
        <td className={pago.venceEl < hoy && pago.estado !== "cancelado" ? "fecha-vencida" : ""}>{fechaLegible(pago.venceEl)}</td>
        <td>{fechaLegible(pago.programadaEl)}</td>
        <td><Insignia tono={tonoEstado(pago.estado)}>{ETIQUETA_ESTADO[pago.estado]}</Insignia></td>
        <td><Link className="abrir-fila" href={href(`${base}&pago=${pago.id}`)} aria-label={`Abrir pago de ${pago.proveedor}`}>→</Link></td>
      </tr>)}</tbody></table></div>
  );
}

function TablaProveedores({ proveedores, pagos, base, href }: { proveedores: ProveedorPago[]; pagos: PagoVista[]; base: string; href: (ruta: string) => string }) {
  if (proveedores.length === 0) return <Vacio titulo="Tu directorio está listo para empezar">Da de alta un proveedor con su constancia, CLABE y contrato.</Vacio>;
  return (
    <div className="tabla-scroll"><table className="tabla-pagos"><thead><tr><th>Proveedor</th><th>Contacto</th><th>CLABE</th><th>Condiciones</th><th>Situación</th><th><span className="solo-lector">Abrir</span></th></tr></thead>
      <tbody>{proveedores.map((proveedor) => {
        const pendientes = pagos.filter((pago) => pago.supplierId === proveedor.id && pago.estado === "por_autorizar").length;
        return <tr key={proveedor.id}>
          <td><Link className="celda-proveedor" href={href(`${base}&proveedor=${proveedor.id}`)}><strong>{proveedor.razonSocial}</strong><span>{proveedor.nombreComercial ?? proveedor.rfc}</span></Link></td>
          <td>{proveedor.contactoCorreo ?? <span className="texto-tenue">Sin correo</span>}</td>
          <td className="celda-mono">•••• {proveedor.clabe.slice(-4)}</td>
          <td>{proveedor.diasCredito} días{pendientes ? <span>{pendientes} por autorizar</span> : null}</td>
          <td><Insignia tono={!proveedor.activo || !proveedor.botonPago ? "aviso" : "sello"}>{!proveedor.activo ? "Inactivo" : proveedor.botonPago ? "Habilitado" : "Revisar"}</Insignia></td>
          <td><Link className="abrir-fila" href={href(`${base}&proveedor=${proveedor.id}`)} aria-label={`Abrir expediente de ${proveedor.razonSocial}`}>→</Link></td>
        </tr>;
      })}</tbody></table></div>
  );
}

function Agenda({ pagos, base, href, hoy }: { pagos: PagoVista[]; base: string; href: (ruta: string) => string; hoy: string }) {
  const activos = pagos.filter((pago) => pago.estado === "por_autorizar" || pago.estado === "listo_para_pagar").toSorted((a, b) => a.programadaEl.localeCompare(b.programadaEl));
  if (activos.length === 0) return <Vacio titulo="No hay desembolsos en la agenda">Al programar una factura aparecerá aquí con su fecha prevista.</Vacio>;
  const grupos = new Map<string, PagoVista[]>();
  for (const pago of activos) grupos.set(pago.programadaEl, [...(grupos.get(pago.programadaEl) ?? []), pago]);
  return <div className="agenda-pagos">{[...grupos].map(([fecha, lineas]) => <section key={fecha} className="agenda-dia">
    <div className="agenda-fecha"><p>{fechaLegible(fecha)}</p><span>{lineas.length} pagos · {formatoPesos(lineas.reduce((total, pago) => total + pago.totalCentavos, 0))}</span></div>
    {lineas.map((pago) => <Link key={pago.id} href={href(`${base}&pago=${pago.id}`)} className="agenda-linea">
      <span className="agenda-marca" aria-hidden="true" /><div><strong>{pago.proveedor}</strong><span>{pago.referencia} · {pago.venceEl < hoy ? "Vencido" : `Vence ${fechaLegible(pago.venceEl)}`}</span></div>
      <strong>{formatoPesos(pago.totalCentavos)}</strong><Insignia tono={tonoEstado(pago.estado)}>{ETIQUETA_ESTADO[pago.estado]}</Insignia>
    </Link>)}
  </section>)}</div>;
}

function DetallePago({ pago, lectura, empresaId, personaId, cerrar, puedeSolicitar, puedeLiberar }: { pago: PagoVista; lectura: LecturaPagosProveedores; empresaId: string; personaId: string; cerrar: string; puedeSolicitar: boolean; puedeLiberar: boolean }) {
  const documentos = lectura.documentos.filter((documento) => documento.payableId === pago.payableId);
  const autoriza = puedeLiberar && pago.estado === "por_autorizar" && pago.solicitadoPor !== personaId;
  const cancela = puedeSolicitar && pago.estado === "por_autorizar" && pago.solicitadoPor === personaId;
  return <aside className="detalle-proveedor" aria-label="Detalle del pago">
    <Cerrar href={enEmpresa(empresaId, cerrar)} />
    <div className="detalle-cabeza"><p className="detalle-kicker">{pago.origen === "cfdi" ? "Factura" : "Excepción documentada"}</p><Insignia tono={tonoEstado(pago.estado)}>{ETIQUETA_ESTADO[pago.estado]}</Insignia><h2>{pago.proveedor}</h2><p>{pago.referencia}</p><strong className="detalle-monto">{formatoPesos(pago.totalCentavos)}</strong><span>MXN</span></div>
    <div className="detalle-instruccion"><EtiquetaMono nombre="CLABE destino">{clabeVisible(pago.clabe)}</EtiquetaMono><p className="pista">{institucionTradicional(pago.clabe.slice(0, 3)) ?? FRASE_INSTITUCION_PENDIENTE}</p></div>
    <Renglones>
      <Renglon etiqueta="Vencimiento">{fechaLegible(pago.venceEl)}</Renglon><Renglon etiqueta="Fecha prevista">{fechaLegible(pago.programadaEl)}</Renglon>
      <Renglon etiqueta="Emisión">{fechaLegible(pago.emitidaEl)}</Renglon><Renglon etiqueta="Solicitó">{pago.solicitante}</Renglon>
      {pago.cfdiUuid ? <Renglon etiqueta="UUID"><span className="detalle-uuid">{pago.cfdiUuid}</span></Renglon> : null}
      {pago.motivoExcepcion ? <Renglon etiqueta="Motivo de excepción">{pago.motivoExcepcion}</Renglon> : null}
      {pago.motivoResolucion ? <Renglon etiqueta="Motivo de resolución">{pago.motivoResolucion}</Renglon> : null}
    </Renglones>
    <Documentos documentos={documentos} empresaId={empresaId} />
    {pago.estado === "rechazado" && puedeSolicitar && pago.solicitadoPor === personaId ? <Link className="boton boton-completo" href={enEmpresa(empresaId, `/consola/proveedores/nuevo?pago=${pago.id}`)}>Corregir y volver a solicitar</Link> : null}
    {autoriza || cancela ? <DecisionPago requestId={pago.id} puedeAutorizar={autoriza} puedeCancelar={cancela} /> : null}
    <div className="detalle-nota"><strong>Qué significa autorizar</strong><p>La instrucción queda lista para una futura operación bancaria. Esta versión no envía SPEI ni confirma recepción.</p></div>
  </aside>;
}

function DetalleProveedor({ proveedor, lectura, historial, empresaId, cerrar, puedeAdministrar }: { proveedor: ProveedorPago; lectura: LecturaPagosProveedores; historial: LecturaClabes; empresaId: string; cerrar: string; puedeAdministrar: boolean }) {
  const documentos = lectura.documentos.filter((documento) => documento.supplierId === proveedor.id);
  const grupo = historial.grupos.find((actual) => actual.supplierId === proveedor.id);
  return <aside className="detalle-proveedor" aria-label="Expediente del proveedor">
    <Cerrar href={enEmpresa(empresaId, cerrar)} />
    <div className="detalle-cabeza"><p className="detalle-kicker">Expediente del proveedor</p><Insignia tono={proveedor.activo && proveedor.botonPago ? "sello" : "aviso"}>{proveedor.activo && proveedor.botonPago ? "Habilitado" : "Pago bloqueado"}</Insignia><h2>{proveedor.razonSocial}</h2><p>{proveedor.nombreComercial ?? proveedor.rfc}</p></div>
    <EtiquetaMono nombre="RFC">{proveedor.rfc}</EtiquetaMono><EtiquetaMono nombre="CLABE">{clabeVisible(proveedor.clabe)}</EtiquetaMono>
    <Renglones>
      <Renglon etiqueta="Institución">{institucionTradicional(proveedor.clabe.slice(0, 3)) ?? FRASE_INSTITUCION_PENDIENTE}</Renglon>
      <Renglon etiqueta="Contacto">{proveedor.contactoCorreo ?? "Sin correo"}</Renglon><Renglon etiqueta="Crédito">{proveedor.diasCredito} días</Renglon>
      <Renglon etiqueta="Lista 69-B">{proveedor.situacion ?? "Fuera de la lista en la última lectura"}</Renglon>
    </Renglones>
    <Documentos documentos={[{ id: proveedor.constanciaId, nombre: proveedor.constancia, tipo: "constancia", supplierId: proveedor.id, payableId: null, vigenteHasta: null }, ...documentos]} empresaId={empresaId} />
    {puedeAdministrar ? <FormularioContrato supplierId={proveedor.id} /> : null}
    {grupo?.vigente && historial.puedeCambiar ? <div className="detalle-clabe"><h3>Cambiar CLABE</h3><p className="pista">La cuenta anterior se conserva. Este cambio exige segundo factor reciente.</p><FormularioCambio supplierId={proveedor.id} /></div> : null}
    {grupo && grupo.anteriores.length > 0 ? <div className="historial-compacto"><h3>CLABE anteriores</h3>{grupo.anteriores.map((linea) => <p key={linea.id}><span>{linea.visible}</span><small>{linea.desde} — {linea.hasta}</small></p>)}</div> : null}
  </aside>;
}

function Documentos({ documentos, empresaId }: { documentos: LecturaPagosProveedores["documentos"]; empresaId: string }) {
  return <div className="detalle-documentos"><h3>Documentos <span>{documentos.length}</span></h3>{documentos.length === 0 ? <p className="pista">No hay documentos adicionales.</p> : documentos.map((documento) => <a key={documento.id} href={enEmpresa(empresaId, `/consola/proveedores/documento/${documento.id}`)}>
    <span className="documento-tipo">{documento.tipo.toUpperCase()}</span><span><strong>{documento.nombre}</strong><small>{documento.vigenteHasta ? `Vigente hasta ${fechaLegible(documento.vigenteHasta)}` : "Archivo privado verificado"}</small></span><span aria-hidden="true">↓</span>
  </a>)}</div>;
}

function Actividad({ lectura }: { lectura: LecturaPagosProveedores }) {
  if (lectura.actividad.length === 0) return null;
  return <section className="actividad-proveedores"><div className="actividad-cabeza"><h2>Actividad reciente</h2><span>Auditoría de la empresa</span></div><div>{lectura.actividad.slice(0, 6).map((evento) => <article key={evento.id}><span className="actividad-punto" /><div><strong>{tituloActividad(evento.accion)}</strong><p>{evento.actor} · {horaEnMexico(new Date(evento.ocurridoEn))}</p></div></article>)}</div></section>;
}

function Cerrar({ href }: { href: string }) { return <Link className="detalle-cerrar" href={href} aria-label="Cerrar detalle">×</Link>; }
function tituloActividad(accion: string): string {
  const titulos: Record<string, string> = { alta_proveedor: "Proveedor creado", clabe_proveedor: "CLABE actualizada", documento_proveedor: "Documento agregado", crear_cargo_proveedor: "Factura u obligación creada", editar_cargo_proveedor: "Obligación corregida", solicitar_pago_proveedor: "Pago enviado a autorización", autorizar_pago_proveedor: "Pago listo para pagar", rechazar_pago_proveedor: "Pago rechazado", cancelar_pago_proveedor: "Solicitud cancelada" };
  return titulos[accion] ?? "Actividad de proveedores";
}
