import Form from "next/form";
import Link from "next/link";

import { IconoBuscar } from "@/components/cromo/iconos";
import { Cancelacion, DecisionPago, FormularioContrato } from "./acciones-pago";
import { DetalleEnPanel } from "./detalle-panel";
import { EsperaEnlace } from "./espera-enlace";
import { FormularioCambio } from "./formulario-cambio";
import { BotonEnviar, EtiquetaMono, Insignia, Metrica, Metricas, Monto, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { formatoPesos, formatoPesosGrande } from "@/dominio/centavos";
import { clabeVisible } from "@/dominio/clabe";
import { institucionTradicional, FRASE_INSTITUCION_PENDIENTE } from "@/dominio/clabe-proveedor";
import { ETIQUETA_ESTADO, ESTADOS_PAGO, fechaLegible, tonoEstado } from "@/dominio/pagos-proveedores";
import { horaEnMexico } from "@/dominio/reloj";
import { enEmpresa } from "@/nucleo/rutas";
import type { LecturaPagosProveedores } from "@/server/pagos-proveedores";
import type { BloqueoPago, PagoVista, ProveedorPago, VersionPagoVista } from "@/dominio/pagos-vistas";
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
  puedeCancelarListo,
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
  puedeCancelarListo: boolean;
  puedeAdministrar: boolean;
}) {
  const pago = pagoId ? lectura.pagos.find((actual) => actual.id === pagoId) : undefined;
  const proveedor = proveedorId ? lectura.proveedores.find((actual) => actual.id === proveedorId) : undefined;
  const href = (ruta: string) => enEmpresa(empresaId, ruta);
  const base = `/consola/proveedores?vista=${vista}${q ? `&q=${encodeURIComponent(q)}` : ""}${estado ? `&estado=${estado}` : ""}`;
  const { metricas } = lectura;

  return (
    <>
      <h1 className="solo-lector">Pagos a proveedores</h1>
      <Metricas etiqueta="Resumen de cuentas por pagar">
        <Metrica rotulo="Por vencer" nota={`${operaciones(metricas.porVencer.cantidad)} · próximos 7 días`}>
          <Monto>{formatoPesosGrande(metricas.porVencer.centavos)}</Monto>
        </Metrica>
        <Metrica rotulo="Vencido" nota={metricas.vencidos.cantidad > 0 ? `${operaciones(metricas.vencidos.cantidad)} · requiere seguimiento` : "Nada vencido"}>
          <Monto>{formatoPesosGrande(metricas.vencidos.centavos)}</Monto>
        </Metrica>
        <Metrica rotulo="Por autorizar" nota={`${operaciones(metricas.porAutorizar.cantidad)} · en revisión`}>
          <Monto>{formatoPesosGrande(metricas.porAutorizar.centavos)}</Monto>
        </Metrica>
        <Metrica rotulo="Listo para pagar" nota={`${operaciones(metricas.listos.cantidad)} · autorizado`}>
          <Monto>{formatoPesosGrande(metricas.listos.centavos)}</Monto>
        </Metrica>
      </Metricas>

      <nav className="segmentado mesa-vistas" aria-label="Espacios de proveedores">
        {(["pagos", "proveedores", "agenda"] as const).map((actual) => (
          <Link key={actual} href={href(`/consola/proveedores?vista=${actual}`)} aria-current={vista === actual ? "page" : undefined}>
            {actual === "pagos" ? `Pagos · ${metricas.porAutorizar.cantidad + metricas.listos.cantidad}` : actual === "proveedores" ? `Proveedores · ${lectura.proveedores.length}` : "Agenda"}
            <EsperaEnlace />
          </Link>
        ))}
      </nav>

      <section className="panel mesa-panel" aria-labelledby="mesa-titulo">
        <div className="panel-cabeza">
          <h2 id="mesa-titulo">{vista === "pagos" ? "Facturas y obligaciones" : vista === "proveedores" ? "Directorio de proveedores" : "Agenda de pagos"}</h2>
          {vista === "proveedores" && puedeAdministrar ? (
            <Link className="boton-texto boton-chico" href={href("/consola/proveedores/nuevo-proveedor")}>Alta de proveedor</Link>
          ) : (
            <small>{vista === "agenda" ? "Ordenada por fecha prevista" : "Otra persona autoriza cada pago"}</small>
          )}
        </div>
        {vista !== "agenda" ? (
          <Form className="buscador-pagos" role="search" aria-label={vista === "proveedores" ? "Filtrar el directorio de proveedores" : "Filtrar facturas y obligaciones"} action={href("/consola/proveedores")}>
            <input type="hidden" name="vista" value={vista} />
            <label className="solo-lector" htmlFor="buscar-pagos">Buscar</label>
            <IconoBuscar />
            <input id="buscar-pagos" type="search" name="q" defaultValue={q} placeholder={vista === "proveedores" ? "Buscar por razón social o RFC" : "Buscar proveedor, factura o UUID"} />
            {vista === "pagos" ? (
              <select name="estado" defaultValue={estado} aria-label="Filtrar por estado">
                <option value="">Todos los estados</option>
                {ESTADOS_PAGO.map((actual) => <option key={actual} value={actual}>{ETIQUETA_ESTADO[actual]}</option>)}
              </select>
            ) : null}
            <BotonEnviar className="boton-texto boton-chico" enviando="Filtrando…">Filtrar</BotonEnviar>
            {q || estado ? <Link href={href(`/consola/proveedores?vista=${vista}`)} className="enlace-texto">Limpiar<EsperaEnlace /></Link> : null}
          </Form>
        ) : null}
        {vista === "pagos" ? <TablaPagos pagos={lectura.pagos} base={base} href={href} hoy={hoy} /> : null}
        {vista === "proveedores" ? <TablaProveedores proveedores={lectura.proveedores} pagos={lectura.pagos} base={base} href={href} /> : null}
        {vista === "agenda" ? <Agenda pagos={lectura.pagos} base={base} href={href} hoy={hoy} /> : null}
        <div className="mesa-pie">
          <span>
            {vista === "pagos"
              ? `${operaciones(lectura.pagos.length)} en esta página`
              : vista === "proveedores"
                ? `${lectura.proveedores.length} ${lectura.proveedores.length === 1 ? "proveedor" : "proveedores"}`
                : `${operaciones(lectura.pagos.filter(enAgenda).length)} por pagar`}
          </span>
          <div>
            {lectura.pagina > 1 ? <Link className="enlace-texto" href={href(`${base}&pagina=${lectura.pagina - 1}`)}>Anterior<EsperaEnlace /></Link> : null}
            {lectura.hayMas ? <Link className="enlace-texto" href={href(`${base}&pagina=${lectura.pagina + 1}`)}>Siguiente<EsperaEnlace /></Link> : null}
          </div>
        </div>
      </section>
      <Actividad lectura={lectura} />
      <NotaRegla>Autorizar deja el pago listo para pagar. El envío del SPEI todavía no sale desde Lever.</NotaRegla>
      {pago ? (
        <DetalleEnPanel key={pago.id} titulo={pago.proveedor} contexto={pago.origen === "cfdi" ? "Factura" : "Excepción documentada"} cerrar={href(base)}>
          <DetallePago pago={pago} lectura={lectura} empresaId={empresaId} personaId={personaId} puedeSolicitar={puedeSolicitar} puedeLiberar={puedeLiberar} puedeCancelarListo={puedeCancelarListo} />
        </DetalleEnPanel>
      ) : null}
      {proveedor ? (
        <DetalleEnPanel key={proveedor.id} titulo={proveedor.razonSocial} contexto="Expediente del proveedor" cerrar={href(base)}>
          <DetalleProveedor proveedor={proveedor} lectura={lectura} historial={historial} empresaId={empresaId} puedeAdministrar={puedeAdministrar} />
        </DetalleEnPanel>
      ) : null}
    </>
  );
}

function operaciones(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? "operación" : "operaciones"}`;
}

function enAgenda(pago: PagoVista): boolean {
  return pago.estado === "por_autorizar" || pago.estado === "listo_para_pagar";
}

function TablaPagos({ pagos, base, href, hoy }: { pagos: PagoVista[]; base: string; href: (ruta: string) => string; hoy: string }) {
  if (pagos.length === 0) return <Vacio titulo="No hay pagos en esta vista">Cambia los filtros o registra una factura para pedir su autorización.</Vacio>;
  return (
    <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de facturas y obligaciones">
      <table className="tabla">
        <thead><tr><th scope="col">Proveedor</th><th scope="col" className="cifra">Importe</th><th scope="col">Vence</th><th scope="col">Fecha prevista</th><th scope="col">Estado</th><th scope="col"><span className="solo-lector">Abrir</span></th></tr></thead>
        <tbody>{pagos.map((pago) => (
          <tr key={pago.id}>
            <td><Link className="celda-proveedor" href={href(`${base}&pago=${pago.id}`)}><strong>{pago.proveedor}</strong><EsperaEnlace /></Link><small>{pago.referencia}{pago.origen === "excepcion" ? " · Excepción" : ""}</small></td>
            <td className="cifra">{formatoPesos(pago.totalCentavos)}</td>
            <td className={pago.venceEl < hoy && pago.estado !== "cancelado" ? "fecha-vencida" : undefined}>{fechaLegible(pago.venceEl)}</td>
            <td>{fechaLegible(pago.programadaEl)}</td>
            <td><Insignia tono={tonoEstado(pago.estado)}>{ETIQUETA_ESTADO[pago.estado]}</Insignia></td>
            <td className="derecha"><Link className="abrir-fila" href={href(`${base}&pago=${pago.id}`)} aria-label={`Abrir pago de ${pago.proveedor}`}>→<EsperaEnlace /></Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function TablaProveedores({ proveedores, pagos, base, href }: { proveedores: ProveedorPago[]; pagos: PagoVista[]; base: string; href: (ruta: string) => string }) {
  if (proveedores.length === 0) return <Vacio titulo="Todavía no hay proveedores">Da de alta un proveedor con su constancia, CLABE y contrato.</Vacio>;
  return (
    <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla del directorio de proveedores">
      <table className="tabla">
        <thead><tr><th scope="col">Proveedor</th><th scope="col">Contacto</th><th scope="col">CLABE</th><th scope="col">Condiciones</th><th scope="col">Situación</th><th scope="col"><span className="solo-lector">Abrir</span></th></tr></thead>
        <tbody>{proveedores.map((proveedor) => {
          const pendientes = pagos.filter((pago) => pago.supplierId === proveedor.id && pago.estado === "por_autorizar").length;
          return (
            <tr key={proveedor.id}>
              <td><Link className="celda-proveedor" href={href(`${base}&proveedor=${proveedor.id}`)}><strong>{proveedor.razonSocial}</strong><EsperaEnlace /></Link><small className="celda-mono">{proveedor.nombreComercial ?? proveedor.rfc}</small></td>
              <td>{proveedor.contactoCorreo ?? <span className="texto-tenue">Sin correo</span>}</td>
              <td className="celda-mono">•••• {proveedor.clabeFinal}</td>
              <td>{proveedor.diasCredito} días{pendientes ? <small>{pendientes} por autorizar</small> : null}</td>
              <td><Insignia tono={!proveedor.activo || !proveedor.botonPago ? "aviso" : "sello"}>{!proveedor.activo ? "Inactivo" : proveedor.botonPago ? "Habilitado" : "Revisar"}</Insignia></td>
              <td className="derecha"><Link className="abrir-fila" href={href(`${base}&proveedor=${proveedor.id}`)} aria-label={`Abrir expediente de ${proveedor.razonSocial}`}>→<EsperaEnlace /></Link></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function Agenda({ pagos, base, href, hoy }: { pagos: PagoVista[]; base: string; href: (ruta: string) => string; hoy: string }) {
  const activos = pagos.filter(enAgenda).toSorted((a, b) => a.programadaEl.localeCompare(b.programadaEl));
  if (activos.length === 0) return <Vacio titulo="No hay pagos en la agenda">Cada factura que programes aparece aquí en su fecha prevista.</Vacio>;
  const grupos = new Map<string, PagoVista[]>();
  for (const pago of activos) grupos.set(pago.programadaEl, [...(grupos.get(pago.programadaEl) ?? []), pago]);
  return <div className="agenda-pagos">{[...grupos].map(([fecha, lineas]) => <section key={fecha} className="agenda-dia" aria-label={fechaLegible(fecha)}>
    <div className="agenda-fecha"><p>{fechaLegible(fecha)}</p><span>{lineas.length} {lineas.length === 1 ? "pago" : "pagos"} · {formatoPesosGrande(lineas.reduce((total, pago) => total + BigInt(pago.totalCentavos), BigInt(0)))}</span></div>
    {lineas.map((pago) => <Link key={pago.id} href={href(`${base}&pago=${pago.id}`)} className="agenda-linea">
      <span className="agenda-marca" aria-hidden="true" /><div><strong>{pago.proveedor}<EsperaEnlace /></strong><span>{pago.referencia} · {pago.venceEl < hoy ? "Vencido" : `Vence ${fechaLegible(pago.venceEl)}`}</span></div>
      <strong>{formatoPesos(pago.totalCentavos)}</strong><Insignia tono={tonoEstado(pago.estado)}>{ETIQUETA_ESTADO[pago.estado]}</Insignia>
    </Link>)}
  </section>)}</div>;
}

function DetallePago({ pago, lectura, empresaId, personaId, puedeSolicitar, puedeLiberar, puedeCancelarListo }: { pago: PagoVista; lectura: LecturaPagosProveedores; empresaId: string; personaId: string; puedeSolicitar: boolean; puedeLiberar: boolean; puedeCancelarListo: boolean }) {
  const documentos = lectura.documentos.filter((documento) => documento.payableId === pago.payableId);
  const autoriza = puedeLiberar && pago.estado === "por_autorizar" && pago.solicitadoPor !== personaId;
  const propia = puedeSolicitar && pago.solicitadoPor === personaId && (pago.estado === "por_autorizar" || pago.estado === "rechazado");
  const cancelaListo = puedeCancelarListo && pago.estado === "listo_para_pagar";
  return <div className="detalle-proveedor">
    <div className="detalle-cabeza"><Insignia tono={tonoEstado(pago.estado)}>{ETIQUETA_ESTADO[pago.estado]}</Insignia><p>{pago.referencia}</p><strong className="detalle-monto">{formatoPesos(pago.totalCentavos)}</strong><span>MXN</span></div>
    {pago.bloqueo ? <p className="aviso-bloqueo" role="note">{TEXTO_BLOQUEO[pago.bloqueo]}</p> : null}
    <div className="detalle-instruccion">
      <EtiquetaMono nombre="CLABE destino">{pago.clabe ? clabeVisible(pago.clabe) : `•••• ${pago.clabeFinal}`}</EtiquetaMono>
      <p className="pista">{pago.clabe ? institucionTradicional(pago.clabe.slice(0, 3)) ?? FRASE_INSTITUCION_PENDIENTE : "Tu rol ve solo la terminación de la CLABE."}</p>
    </div>
    <Renglones>
      <Renglon etiqueta="Vencimiento">{fechaLegible(pago.venceEl)}</Renglon><Renglon etiqueta="Fecha prevista">{fechaLegible(pago.programadaEl)}</Renglon>
      <Renglon etiqueta="Emisión">{fechaLegible(pago.emitidaEl)}</Renglon><Renglon etiqueta="Solicitó">{pago.solicitante}</Renglon>
      {pago.cfdiUuid ? <Renglon etiqueta="UUID"><span className="detalle-uuid">{pago.cfdiUuid}</span></Renglon> : null}
      {pago.motivoExcepcion ? <Renglon etiqueta="Motivo de excepción">{pago.motivoExcepcion}</Renglon> : null}
      {pago.motivoResolucion ? <Renglon etiqueta="Motivo de resolución">{pago.motivoResolucion}</Renglon> : null}
    </Renglones>
    <Historial pago={pago} versiones={lectura.historial} />
    <Documentos documentos={documentos} empresaId={empresaId} />
    {pago.estado === "rechazado" && puedeSolicitar && pago.solicitadoPor === personaId ? <Link className="boton boton-completo" href={enEmpresa(empresaId, `/consola/proveedores/nuevo?pago=${pago.id}`)}>Corregir y volver a solicitar</Link> : null}
    {autoriza ? <DecisionPago key={`${pago.id}-${pago.version}`} requestId={pago.id} version={pago.version} totalCentavos={pago.totalCentavos} puedeAutorizar={autoriza} soloRechazo={pago.bloqueo !== null} /> : null}
    {propia ? <Cancelacion requestId={pago.id} tipo="propia" /> : null}
    {cancelaListo ? <Cancelacion requestId={pago.id} tipo="listo" /> : null}
  </div>;
}

function DetalleProveedor({ proveedor, lectura, historial, empresaId, puedeAdministrar }: { proveedor: ProveedorPago; lectura: LecturaPagosProveedores; historial: LecturaClabes; empresaId: string; puedeAdministrar: boolean }) {
  const documentos = lectura.documentos.filter((documento) => documento.supplierId === proveedor.id);
  const grupo = historial.grupos.find((actual) => actual.supplierId === proveedor.id);
  return <div className="detalle-proveedor">
    <div className="detalle-cabeza"><Insignia tono={proveedor.activo && proveedor.botonPago ? "sello" : "aviso"}>{proveedor.activo && proveedor.botonPago ? "Habilitado" : "Pago bloqueado"}</Insignia>{proveedor.nombreComercial ? <p>{proveedor.nombreComercial}</p> : null}</div>
    <EtiquetaMono nombre="RFC">{proveedor.rfc}</EtiquetaMono><EtiquetaMono nombre="CLABE">{proveedor.clabe ? clabeVisible(proveedor.clabe) : `•••• ${proveedor.clabeFinal}`}</EtiquetaMono>
    <Renglones>
      <Renglon etiqueta="Institución">{proveedor.clabe ? institucionTradicional(proveedor.clabe.slice(0, 3)) ?? FRASE_INSTITUCION_PENDIENTE : "Visible para administración, liberadores y contabilidad"}</Renglon>
      <Renglon etiqueta="Contacto">{proveedor.contactoCorreo ?? "Sin correo"}</Renglon><Renglon etiqueta="Crédito">{proveedor.diasCredito} días</Renglon>
      <Renglon etiqueta="Lista 69-B">{proveedor.situacion ?? "Fuera de la lista en la última lectura"}</Renglon>
    </Renglones>
    {proveedor.constanciaId && proveedor.constancia
      ? <Documentos documentos={[{ id: proveedor.constanciaId, nombre: proveedor.constancia, tipo: "constancia", supplierId: proveedor.id, payableId: null, vigenteHasta: null }, ...documentos]} empresaId={empresaId} />
      : <p className="pista">La constancia y los contratos del proveedor los consultan administración, liberadores y contabilidad.</p>}
    {puedeAdministrar ? <FormularioContrato supplierId={proveedor.id} /> : null}
    {grupo?.vigente && historial.puedeCambiar ? <div className="detalle-clabe"><h3>Cambiar CLABE</h3><p className="pista">La cuenta anterior se conserva. Este cambio exige segundo factor reciente.</p><FormularioCambio supplierId={proveedor.id} /></div> : null}
    {grupo && grupo.anteriores.length > 0 ? <div className="historial-compacto"><h3>CLABE anteriores</h3>{grupo.anteriores.map((linea) => <p key={linea.id}><span>{linea.visible}</span><small>{linea.desde} — {linea.hasta}</small></p>)}</div> : null}
  </div>;
}

function Documentos({ documentos, empresaId }: { documentos: LecturaPagosProveedores["documentos"]; empresaId: string }) {
  return <div className="detalle-documentos"><h3>Documentos <span>{documentos.length}</span></h3>{documentos.length === 0 ? <p className="pista">No hay documentos adicionales.</p> : documentos.map((documento) => <a key={documento.id} href={enEmpresa(empresaId, `/consola/proveedores/documento/${documento.id}`)}>
    <span className="documento-tipo">{documento.tipo.toUpperCase()}</span><span><strong>{documento.nombre}</strong><small>{documento.vigenteHasta ? `Vigente hasta ${fechaLegible(documento.vigenteHasta)}` : documento.tipo === "xml" ? "XML leído; validación ante el SAT pendiente" : "Archivo privado · se descarga"}</small></span><span aria-hidden="true">↓</span>
  </a>)}</div>;
}

function Actividad({ lectura }: { lectura: LecturaPagosProveedores }) {
  if (lectura.actividad.length === 0) return null;
  return <section className="panel actividad-proveedores" aria-labelledby="actividad-titulo"><div className="panel-cabeza"><h2 id="actividad-titulo">Actividad reciente</h2><small>Bitácora de la empresa</small></div><div>{lectura.actividad.slice(0, 6).map((evento) => <article key={evento.id}><span className="actividad-punto" aria-hidden="true" /><div><strong>{tituloActividad(evento.accion)}</strong><p>{evento.actor} · {horaEnMexico(new Date(evento.ocurridoEn))}</p></div></article>)}</div></section>;
}

function tituloActividad(accion: string): string {
  const titulos: Record<string, string> = { alta_proveedor: "Proveedor creado", clabe_proveedor: "CLABE actualizada", documento_proveedor: "Documento agregado", crear_cargo_proveedor: "Factura u obligación creada", editar_cargo_proveedor: "Obligación corregida", solicitar_pago_proveedor: "Pago enviado a autorización", autorizar_pago_proveedor: "Pago listo para pagar", rechazar_pago_proveedor: "Pago rechazado", cancelar_pago_proveedor: "Solicitud cancelada", regresar_pago_proveedor: "Autorización retirada: pago de vuelta en revisión" };
  return titulos[accion] ?? "Actividad de proveedores";
}

const TEXTO_BLOQUEO: Record<Exclude<BloqueoPago, null>, string> = {
  clabe_cambiada: "La CLABE del proveedor cambió después de esta solicitud. No se puede autorizar con la cuenta anterior: recházala para que se vuelva a solicitar con la CLABE vigente.",
  proveedor_bloqueado: "El proveedor está bloqueado (lista 69-B o inactivo). No se puede autorizar mientras siga así.",
};

/** La versión anterior de la solicitud: quién la resolvió, por qué y qué cambió desde entonces. */
function Historial({ pago, versiones }: { pago: PagoVista; versiones: VersionPagoVista[] }) {
  const cierres = versiones.filter((version) => version.estado !== version.estadoNuevo && version.estado !== "por_autorizar");
  if (cierres.length === 0) return null;
  const anterior = versiones.find((version) => version.version < pago.version);
  return <div className="historial-pago">
    <h3>Historial de la solicitud</h3>
    {anterior ? <div className="historial-diferencia" aria-label="Diferencia con la versión anterior">
      <p><strong>Versión {pago.version}</strong> frente a la versión {anterior.version}</p>
      <dl>
        <Diferencia etiqueta="Importe" antes={formatoPesos(anterior.totalCentavos)} ahora={formatoPesos(pago.totalCentavos)} />
        <Diferencia etiqueta="Fecha prevista" antes={fechaLegible(anterior.programadaEl)} ahora={fechaLegible(pago.programadaEl)} />
        <Diferencia etiqueta="CLABE" antes={`•••• ${anterior.clabeFinal}`} ahora={`•••• ${pago.clabeFinal}`} />
      </dl>
    </div> : null}
    <ol>{cierres.map((version) => <li key={`${version.version}-${version.cerradoEn}`}>
      <strong>{TITULO_CIERRE[version.estado] ?? "Cambio"} · versión {version.version}</strong>
      <span>{version.estado === "rechazado" ? "Rechazó" : "Autorizó"} {version.resolvio ?? "el sistema"}{version.resueltoEn ? ` · ${horaEnMexico(new Date(version.resueltoEn))}` : ""}</span>
      {version.motivo ? <p>{version.motivo}</p> : null}
    </li>)}</ol>
  </div>;
}

const TITULO_CIERRE: Partial<Record<VersionPagoVista["estado"], string>> = {
  rechazado: "Rechazada",
  listo_para_pagar: "Autorización retirada",
};

function Diferencia({ etiqueta, antes, ahora }: { etiqueta: string; antes: string; ahora: string }) {
  const cambio = antes !== ahora;
  return <div className={cambio ? "cambio" : undefined}><dt>{etiqueta}</dt><dd>{cambio ? <><s>{antes}</s> → <strong>{ahora}</strong></> : <span>{ahora} · sin cambio</span>}</dd></div>;
}
