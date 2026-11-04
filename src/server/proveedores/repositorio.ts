import { decisionGuardada } from "../../dominio/proveedores";
import { baseCliente } from "../../nucleo/contexto";
import { bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type {
  ClabeNueva,
  ContextoProveedores,
  DocumentoNuevo,
  LecturaLista,
  ProveedorNuevo,
  RepositorioProveedores,
} from "./tipos";

// La empresa es la del contexto. Ninguna lectura trae la clave del archivo ni un hash.
export const SQL = {
  rfcOcupado: `
    select 1 as presente
    from suppliers
    where company_id = $1 and rfc = $2
    limit 1
  `,
  snapshot: `
    select id, to_char(fecha_archivo, 'YYYY-MM-DD') as fecha_archivo,
           cargado_en
    from lista_69b_snapshots
    order by cargado_en desc, id desc
    limit 1
  `,
  situaciones: `
    select situacion
    from lista_69b_rows
    where snapshot_id = $1 and rfc = $2
    order by situacion
  `,
  proveedores: `
    select s.id, s.rfc, s.razon_social, s.situacion_69b,
           to_char(s.lista_fecha, 'YYYY-MM-DD') as lista_fecha,
           s.lista_leida_en, c.clabe, d.nombre_original
    from suppliers s
    join supplier_clabes c
      on c.supplier_id = s.id
     and c.company_id = s.company_id
     and c.vigente_hasta is null
    join documents d on d.id = s.document_id and d.company_id = s.company_id
    where s.company_id = $1
    order by s.alta_en desc, s.id
  `,
  insertarDocumento: `
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
    values ($1, $2, $3, $4, $5, $6, $7)
  `,
  insertarProveedor: `
    insert into suppliers (
      id, company_id, document_id, snapshot_id, rfc, razon_social,
      situacion_69b, lista_fecha, lista_leida_en, boton_pago, alta_en
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `,
  insertarClabe: `
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
    values ($1, $2, $3, $4, true, $5)
  `,
} as const;

export function repositorioPg(): RepositorioProveedores {
  return {
    conEmpresa(ctx, fn) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        return fn(contexto(consulta, ctx.empresa.id));
      });
    },
    leer(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const proveedores = await consulta.query(SQL.proveedores, [ctx.empresa.id]);
        const snapshot = await consulta.query(SQL.snapshot, []);
        return {
          lista: mapearLista(snapshot.rows[0]),
          proveedores: proveedores.rows.map((fila) => mapearProveedor(fila)),
        };
      });
    },
  };
}

function contexto(consulta: Consulta, companyId: string): ContextoProveedores {
  return {
    companyId,
    consulta,
    async rfcOcupado(rfc) {
      const resultado = await consulta.query(SQL.rfcOcupado, [companyId, rfc]);
      return resultado.rowCount > 0;
    },
    async leerLista(rfc) {
      const snapshot = await consulta.query(SQL.snapshot, []);
      const fila = snapshot.rows[0] as { id?: unknown; fecha_archivo?: unknown } | undefined;
      if (!fila || typeof fila.id !== "string") {
        return { snapshotId: null, fechaArchivo: null, situaciones: [] };
      }
      const fecha = fechaDe(fila.fecha_archivo);
      if (!fecha) throw new ErrorDeDominio("base_no_disponible");
      const situaciones = await consulta.query(SQL.situaciones, [fila.id, rfc]);
      return {
        snapshotId: fila.id,
        fechaArchivo: fecha,
        situaciones: situaciones.rows.map((item) => {
          const situacion = (item as { situacion?: unknown }).situacion;
          if (typeof situacion !== "string" || situacion.length === 0) {
            throw new ErrorDeDominio("base_no_disponible");
          }
          return situacion;
        }),
      };
    },
    async insertarDocumento(documento) {
      await consulta.query(SQL.insertarDocumento, [
        documento.id,
        companyId,
        documento.clave,
        documento.hash,
        documento.tipo,
        documento.nombre,
        documento.creadoEn,
      ]);
    },
    async insertarProveedor(proveedor) {
      await consulta.query(SQL.insertarProveedor, [
        proveedor.id,
        companyId,
        proveedor.documentId,
        proveedor.snapshotId,
        proveedor.rfc,
        proveedor.razonSocial,
        proveedor.situacion,
        proveedor.fechaArchivo,
        proveedor.leidaEn,
        proveedor.botonPago,
        proveedor.altaEn,
      ]);
    },
    async insertarClabe(clabe) {
      await consulta.query(SQL.insertarClabe, [
        clabe.id,
        companyId,
        clabe.supplierId,
        clabe.clabe,
        clabe.desde,
      ]);
    },
  };
}

function mapearProveedor(fila: unknown) {
  const registro = fila as {
    id?: unknown;
    rfc?: unknown;
    razon_social?: unknown;
    situacion_69b?: unknown;
    lista_fecha?: unknown;
    lista_leida_en?: unknown;
    clabe?: unknown;
    nombre_original?: unknown;
  };
  const leidaEn = instanteIso(registro.lista_leida_en);
  if (
    typeof registro.id !== "string" ||
    typeof registro.rfc !== "string" ||
    typeof registro.razon_social !== "string" ||
    typeof registro.clabe !== "string" ||
    typeof registro.nombre_original !== "string" ||
    !leidaEn ||
    !/^[0-9]{18}$/.test(registro.clabe)
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const fechaArchivo = registro.lista_fecha == null ? null : fechaDe(registro.lista_fecha);
  if (registro.lista_fecha != null && !fechaArchivo) throw new ErrorDeDominio("base_no_disponible");
  const situacion = registro.situacion_69b == null ? null : registro.situacion_69b;
  if (situacion !== null && typeof situacion !== "string") throw new ErrorDeDominio("base_no_disponible");
  return {
    id: registro.id,
    rfc: registro.rfc,
    razonSocial: registro.razon_social,
    clabe: registro.clabe,
    constancia: registro.nombre_original,
    decision: decisionGuardada({ situacion, fechaArchivo }),
    leidaEn,
  };
}

function mapearLista(fila: unknown) {
  if (!fila) return null;
  const registro = fila as { fecha_archivo?: unknown; cargado_en?: unknown };
  const fechaArchivo = fechaDe(registro.fecha_archivo);
  const cargadoEn = instanteIso(registro.cargado_en);
  if (!fechaArchivo || !cargadoEn) throw new ErrorDeDominio("base_no_disponible");
  return { fechaArchivo, cargadoEn };
}

function fechaDe(valor: unknown): string | null {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10);
  return null;
}

function instanteIso(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  if (typeof valor === "string") {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha.toISOString();
  }
  return null;
}

export type { LecturaLista, DocumentoNuevo, ProveedorNuevo, ClabeNueva };
