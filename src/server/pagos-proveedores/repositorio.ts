import { ESTADOS_PAGO, uuidPago, type EstadoPago } from "../../dominio/pagos-proveedores";
import { baseCliente } from "../../nucleo/contexto";
import { bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type {
  ContextoPagos,
  DocumentoVista,
  MetricasPagos,
  PagoVista,
  ProveedorPago,
  RepositorioPagos,
  SolicitudActual,
} from "./tipos";

export function repositorioPg(): RepositorioPagos {
  return {
    async leer(ctx, filtros) {
      const q = (filtros.q ?? "").trim().slice(0, 100);
      const estado = ESTADOS_PAGO.includes(filtros.estado as EstadoPago) ? (filtros.estado as EstadoPago) : "";
      const pagoId = uuidPago(filtros.pagoId) ? filtros.pagoId : "";
      const pagina = Math.max(1, Math.min(10_000, Math.trunc(filtros.pagina ?? 1) || 1));
      return conContexto(baseCliente(ctx), async (consulta) => {
        const proveedores = await consulta.query(`select s.id, s.rfc, s.razon_social, s.nombre_comercial, s.contacto_correo,
              s.dias_credito, s.activo, s.boton_pago, s.situacion_69b,
              c.id as clabe_id, c.clabe, d.id as constancia_id, d.nombre_original as constancia
            from suppliers s
            join supplier_clabes c on c.company_id = s.company_id and c.supplier_id = s.id and c.vigente_hasta is null
            join documents d on d.company_id = s.company_id and d.id = s.document_id
            where s.company_id = $1 and ($2 = '' or s.razon_social ilike $3 or s.nombre_comercial ilike $3 or s.rfc ilike $3)
            order by s.activo desc, s.razon_social, s.id limit 200`, [ctx.empresa.id, q, `%${q}%`]);
        const pagos = await consulta.query(`select r.id, p.id as payable_id, s.id as supplier_id, s.razon_social, s.rfc,
              p.referencia, p.origen, p.cfdi_uuid, p.total_centavos,
              to_char(p.emitida_el, 'YYYY-MM-DD') as emitida_el,
              to_char(p.vence_el, 'YYYY-MM-DD') as vence_el,
              to_char(p.programada_el, 'YYYY-MM-DD') as programada_el,
              r.estado, r.clabe, r.solicitado_por, u.nombre as solicitante, r.resuelto_por,
              r.motivo_resolucion, p.motivo_excepcion, r.version
            from supplier_payment_requests r
            join supplier_payables p on p.company_id = r.company_id and p.id = r.payable_id
            join suppliers s on s.company_id = p.company_id and s.id = p.supplier_id
            join users u on u.id = r.solicitado_por
            where r.company_id = $1 and ($2 = '' or s.razon_social ilike $4 or s.rfc ilike $4 or p.referencia ilike $4 or p.cfdi_uuid ilike $4)
              and ($3 = '' or r.estado = $3) and ($6 = '' or r.id = $6::uuid)
            order by r.estado = 'por_autorizar' desc, p.programada_el, p.vence_el, s.razon_social, r.id
            limit 51 offset $5`, [ctx.empresa.id, q, estado, `%${q}%`, (pagina - 1) * 50, pagoId]);
        const documentos = await consulta.query(`select d.id, d.nombre_original, sd.tipo, sd.supplier_id, null::uuid as payable_id,
              to_char(sd.vigente_hasta, 'YYYY-MM-DD') as vigente_hasta
            from supplier_documents sd join documents d on d.company_id = sd.company_id and d.id = sd.document_id
            where sd.company_id = $1
            union all
            select d.id, d.nombre_original, pd.tipo, null::uuid as supplier_id, pd.payable_id, null as vigente_hasta
            from supplier_payable_documents pd join documents d on d.company_id = pd.company_id and d.id = pd.document_id
            where pd.company_id = $1
            order by nombre_original limit 500`, [ctx.empresa.id]);
        const actividad = await consulta.query(`select a.id, a.accion, a.identificador, coalesce(u.nombre, 'Sistema') as actor, a.ocurrido_en
            from audit_log a left join users u on u.id = a.actor_id
            where a.company_id = $1 and a.accion = any($2)
            order by a.ocurrido_en desc, a.id desc limit 12`, [ctx.empresa.id, [
              "alta_proveedor", "clabe_proveedor", "documento_proveedor", "crear_cargo_proveedor",
              "editar_cargo_proveedor", "solicitar_pago_proveedor", "autorizar_pago_proveedor",
              "rechazar_pago_proveedor", "cancelar_pago_proveedor",
            ]]);
        const metricas = await consulta.query(`select
              count(*) filter (where r.estado in ('por_autorizar','listo_para_pagar') and p.vence_el >= hoy and p.vence_el <= hoy + 7)::int as por_vencer_cantidad,
              coalesce(sum(p.total_centavos) filter (where r.estado in ('por_autorizar','listo_para_pagar') and p.vence_el >= hoy and p.vence_el <= hoy + 7), 0) as por_vencer_centavos,
              count(*) filter (where r.estado in ('por_autorizar','listo_para_pagar') and p.vence_el < hoy)::int as vencidos_cantidad,
              coalesce(sum(p.total_centavos) filter (where r.estado in ('por_autorizar','listo_para_pagar') and p.vence_el < hoy), 0) as vencidos_centavos,
              count(*) filter (where r.estado = 'por_autorizar')::int as autorizar_cantidad,
              coalesce(sum(p.total_centavos) filter (where r.estado = 'por_autorizar'), 0) as autorizar_centavos,
              count(*) filter (where r.estado = 'listo_para_pagar')::int as listos_cantidad,
              coalesce(sum(p.total_centavos) filter (where r.estado = 'listo_para_pagar'), 0) as listos_centavos
            from supplier_payment_requests r join supplier_payables p on p.company_id = r.company_id and p.id = r.payable_id
            cross join (select (timezone('America/Mexico_City', clock_timestamp()))::date as hoy) fecha
            where r.company_id = $1`, [ctx.empresa.id]);
        return {
          proveedores: proveedores.rows.map(mapearProveedor),
          pagos: pagos.rows.slice(0, 50).map(mapearPago),
          documentos: documentos.rows.map(mapearDocumento),
          actividad: actividad.rows.map(mapearActividad),
          metricas: mapearMetricas(metricas.rows[0]),
          pagina,
          hayMas: pagos.rows.length > 50,
        };
      });
    },
    conEmpresa(ctx, fn) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        return fn(contexto(consulta, ctx.empresa.id));
      });
    },
    async documento(ctx, id) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(
          `select id, clave_blob, hash_sha256, nombre_original, tipo from documents where company_id = $1 and id = $2`,
          [ctx.empresa.id, id],
        );
        const fila = resultado.rows[0] as Record<string, unknown> | undefined;
        if (!fila || typeof fila.id !== "string" || typeof fila.clave_blob !== "string" || typeof fila.hash_sha256 !== "string" || typeof fila.nombre_original !== "string" || typeof fila.tipo !== "string") return null;
        return { id: fila.id, clave: fila.clave_blob, hash: fila.hash_sha256, nombre: fila.nombre_original, tipo: fila.tipo };
      });
    },
  };
}

function contexto(consulta: Consulta, companyId: string): ContextoPagos {
  return {
    companyId,
    consulta,
    async proveedor(supplierId) {
      const resultado = await consulta.query(`select s.id, s.rfc, s.razon_social, s.nombre_comercial, s.contacto_correo,
        s.dias_credito, s.activo, s.boton_pago, s.situacion_69b,
        c.id as clabe_id, c.clabe, d.id as constancia_id, d.nombre_original as constancia
        from suppliers s
        join supplier_clabes c on c.company_id = s.company_id and c.supplier_id = s.id and c.vigente_hasta is null
        join documents d on d.company_id = s.company_id and d.id = s.document_id
        where s.company_id = $1 and s.id = $2`, [companyId, supplierId]);
      return resultado.rows[0] ? mapearProveedor(resultado.rows[0]) : null;
    },
    async insertarDocumento(documento) {
      await consulta.query(`insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
        values ($1, $2, $3, $4, $5, $6, $7)`, [documento.id, companyId, documento.clave, documento.hash, documento.tipo, documento.nombre, documento.creadoEn]);
    },
    async vincularDocumentoProveedor(documentoId, supplierId, tipo, vigenteDesde, vigenteHasta, creadoEn) {
      await consulta.query(`insert into supplier_documents (document_id, company_id, supplier_id, tipo, vigente_desde, vigente_hasta, creado_en)
        values ($1, $2, $3, $4, $5, $6, $7)`, [documentoId, companyId, supplierId, tipo, vigenteDesde, vigenteHasta, creadoEn]);
    },
    async insertarCargo(cargo) {
      await consulta.query(`insert into supplier_payables (
        id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos,
        emitida_el, vence_el, programada_el, motivo_excepcion, creado_por, creado_en, actualizado_en
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`, [
        cargo.id, companyId, cargo.supplierId, cargo.origen, cargo.cfdiUuid, cargo.serie, cargo.folio,
        cargo.referencia, cargo.totalCentavos, cargo.emitidaEl, cargo.venceEl, cargo.programadaEl,
        cargo.motivoExcepcion, cargo.creadoPor, cargo.creadoEn,
      ]);
    },
    async cargo(payableId) {
      const resultado = await consulta.query(`select id, supplier_id, origen, cfdi_uuid, serie, folio, referencia,
        total_centavos, to_char(emitida_el, 'YYYY-MM-DD') as emitida_el,
        to_char(vence_el, 'YYYY-MM-DD') as vence_el, to_char(programada_el, 'YYYY-MM-DD') as programada_el,
        motivo_excepcion, creado_por, creado_en
        from supplier_payables where company_id = $1 and id = $2 for update`, [companyId, payableId]);
      const r = resultado.rows[0] as Record<string, unknown> | undefined;
      if (!r) return null;
      const origen = texto(r.origen);
      if (origen !== "cfdi" && origen !== "excepcion") throw new ErrorDeDominio("base_no_disponible");
      const creadoEn = r.creado_en instanceof Date ? r.creado_en : new Date(texto(r.creado_en));
      return {
        id: texto(r.id), supplierId: texto(r.supplier_id), origen, cfdiUuid: nullable(r.cfdi_uuid),
        serie: nullable(r.serie), folio: nullable(r.folio), referencia: texto(r.referencia),
        totalCentavos: entero(r.total_centavos), emitidaEl: texto(r.emitida_el), venceEl: texto(r.vence_el),
        programadaEl: texto(r.programada_el), motivoExcepcion: nullable(r.motivo_excepcion),
        creadoPor: texto(r.creado_por), creadoEn,
      };
    },
    async vincularDocumentoCargo(documentoId, payableId, tipo, creadoEn) {
      await consulta.query(`insert into supplier_payable_documents (document_id, company_id, payable_id, tipo, creado_en)
        values ($1, $2, $3, $4, $5)`, [documentoId, companyId, payableId, tipo, creadoEn]);
    },
    async insertarSolicitud(solicitud) {
      await consulta.query(`insert into supplier_payment_requests (
        id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el,
        solicitado_por, solicitado_en, client_request_id, creado_en
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)`, [
        solicitud.id, companyId, solicitud.payableId, solicitud.supplierClabeId, solicitud.clabe,
        solicitud.totalCentavos, solicitud.programadaEl, solicitud.solicitadoPor, solicitud.solicitadoEn, solicitud.clientRequestId,
      ]);
    },
    async solicitudPorClave(clientRequestId) {
      const resultado = await consulta.query(`select id, payable_id from supplier_payment_requests
        where company_id = $1 and client_request_id = $2`, [companyId, clientRequestId]);
      const fila = resultado.rows[0] as Record<string, unknown> | undefined;
      if (!fila) return null;
      return { requestId: texto(fila.id), payableId: texto(fila.payable_id) };
    },
    async solicitud(id) {
      const resultado = await consulta.query(`select id, payable_id, estado, solicitado_por, version
        from supplier_payment_requests where company_id = $1 and id = $2 for update`, [companyId, id]);
      const fila = resultado.rows[0] as Record<string, unknown> | undefined;
      if (!fila) return null;
      if (typeof fila.id !== "string" || typeof fila.payable_id !== "string" || typeof fila.solicitado_por !== "string" || !ESTADOS_PAGO.includes(fila.estado as EstadoPago)) {
        throw new ErrorDeDominio("base_no_disponible");
      }
      return { id: fila.id, payableId: fila.payable_id, estado: fila.estado as EstadoPago, solicitadoPor: fila.solicitado_por, version: Number(fila.version) } satisfies SolicitudActual;
    },
    async actualizarCargo(cargo) {
      const resultado = await consulta.query(`update supplier_payables set
        serie = $3, folio = $4, referencia = $5, total_centavos = $6, emitida_el = $7,
        vence_el = $8, programada_el = $9, motivo_excepcion = $10, actualizado_en = $11
        where company_id = $1 and id = $2`, [companyId, cargo.id, cargo.serie, cargo.folio, cargo.referencia,
        cargo.totalCentavos, cargo.emitidaEl, cargo.venceEl, cargo.programadaEl, cargo.motivoExcepcion, cargo.actualizadoEn]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("pago_no_autorizable");
    },
    async actualizarSolicitud(entrada) {
      const resultado = entrada.instantanea
        ? await consulta.query(`update supplier_payment_requests set estado = 'por_autorizar',
            solicitado_por = $3, solicitado_en = $4, supplier_clabe_id = $5, clabe = $6,
            total_centavos = $7, programada_el = $8, resuelto_por = null, resuelto_en = null,
            motivo_resolucion = null, version = $9
            where company_id = $1 and id = $2 and estado = 'rechazado' and version = $10`, [
            companyId, entrada.id, entrada.actor, entrada.instantanea.solicitadoEn, entrada.instantanea.supplierClabeId,
            entrada.instantanea.clabe, entrada.instantanea.totalCentavos, entrada.instantanea.programadaEl,
            entrada.version, entrada.version - 1,
          ])
        : await consulta.query(`update supplier_payment_requests set estado = $3,
            resuelto_por = $4, resuelto_en = $5, motivo_resolucion = $6
            where company_id = $1 and id = $2 and estado = 'por_autorizar' and version = $7`, [
            companyId, entrada.id, entrada.estado, entrada.actor, entrada.ahora, entrada.motivo, entrada.version,
          ]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("pago_no_autorizable");
    },
  };
}

function mapearProveedor(valor: unknown): ProveedorPago {
  const r = registro(valor);
  return {
    id: texto(r.id), rfc: texto(r.rfc), razonSocial: texto(r.razon_social),
    nombreComercial: nullable(r.nombre_comercial), contactoCorreo: nullable(r.contacto_correo),
    diasCredito: entero(r.dias_credito), activo: booleano(r.activo), botonPago: booleano(r.boton_pago),
    situacion: nullable(r.situacion_69b), clabeId: texto(r.clabe_id), clabe: texto(r.clabe),
    constanciaId: texto(r.constancia_id), constancia: texto(r.constancia),
  };
}

function mapearPago(valor: unknown): PagoVista {
  const r = registro(valor);
  const estado = texto(r.estado) as EstadoPago;
  const origen = texto(r.origen);
  if (!ESTADOS_PAGO.includes(estado) || (origen !== "cfdi" && origen !== "excepcion")) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: texto(r.id), payableId: texto(r.payable_id), supplierId: texto(r.supplier_id),
    proveedor: texto(r.razon_social), rfc: texto(r.rfc), referencia: texto(r.referencia), origen,
    cfdiUuid: nullable(r.cfdi_uuid), totalCentavos: entero(r.total_centavos), emitidaEl: texto(r.emitida_el),
    venceEl: texto(r.vence_el), programadaEl: texto(r.programada_el), estado, clabe: texto(r.clabe),
    solicitadoPor: texto(r.solicitado_por), solicitante: texto(r.solicitante), resueltoPor: nullable(r.resuelto_por),
    motivoResolucion: nullable(r.motivo_resolucion), motivoExcepcion: nullable(r.motivo_excepcion), version: entero(r.version),
  };
}

function mapearDocumento(valor: unknown): DocumentoVista {
  const r = registro(valor);
  return { id: texto(r.id), nombre: texto(r.nombre_original), tipo: texto(r.tipo), supplierId: nullable(r.supplier_id), payableId: nullable(r.payable_id), vigenteHasta: nullable(r.vigente_hasta) };
}

function mapearActividad(valor: unknown) {
  const r = registro(valor);
  const fecha = r.ocurrido_en instanceof Date ? r.ocurrido_en.toISOString() : texto(r.ocurrido_en);
  return { id: texto(r.id), accion: texto(r.accion), identificador: nullable(r.identificador), actor: texto(r.actor), ocurridoEn: fecha };
}

function mapearMetricas(valor: unknown): MetricasPagos {
  const r = registro(valor);
  return {
    porVencer: { cantidad: entero(r.por_vencer_cantidad), centavos: entero(r.por_vencer_centavos) },
    vencidos: { cantidad: entero(r.vencidos_cantidad), centavos: entero(r.vencidos_centavos) },
    porAutorizar: { cantidad: entero(r.autorizar_cantidad), centavos: entero(r.autorizar_centavos) },
    listos: { cantidad: entero(r.listos_cantidad), centavos: entero(r.listos_centavos) },
  };
}

function registro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null) throw new ErrorDeDominio("base_no_disponible");
  return valor as Record<string, unknown>;
}
function texto(valor: unknown): string {
  if (typeof valor !== "string" || !valor) throw new ErrorDeDominio("base_no_disponible");
  return valor;
}
function nullable(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  return texto(valor);
}
function entero(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero)) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}
function booleano(valor: unknown): boolean {
  if (typeof valor !== "boolean") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}
