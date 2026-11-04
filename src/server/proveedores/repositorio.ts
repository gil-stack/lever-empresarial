import { decisionGuardada } from "../../dominio/proveedores";
import { conTransaccion, consultar, type Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { ROLES, type Rol } from "../session/tipos";
import type {
  ClabeNueva,
  ContextoProveedores,
  DocumentoNuevo,
  LecturaLista,
  ProveedorNuevo,
  RepositorioProveedores,
  SnapshotNuevo,
} from "./tipos";

// El company_id sale de la membresía. Ninguna lectura trae la clave del archivo ni un hash.
export const SQL = {
  bloquearEmpresa: `
    select m.company_id, m.rol
    from memberships m
    join companies c on c.id = m.company_id
    where m.user_id = $1
    for update of c
  `,
  puerta: "select rol, company_id from memberships where user_id = $1",
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
  insertarSnapshot: `
    insert into lista_69b_snapshots (id, fecha_archivo, cargado_en)
    values ($1, $2::date, $3)
  `,
} as const;

const LOTE = 400;

export function repositorioPg(): RepositorioProveedores {
  return {
    conEmpresa(userId, fn) {
      return conTransaccion(async (consulta) => {
        const puerta = await consulta.query(SQL.bloquearEmpresa, [userId]);
        const fila = puerta.rows[0] as { company_id?: unknown; rol?: unknown } | undefined;
        if (!fila || typeof fila.company_id !== "string") throw new ErrorDeDominio("sin_empresa");
        const rol = rolLeido(fila.rol);
        if (!rol) throw new ErrorDeDominio("base_no_disponible");
        return fn(contexto(consulta, fila.company_id, rol));
      });
    },
    async leer(userId) {
      const puerta = await consultar(SQL.puerta, [userId]);
      const miembro = puerta.rows[0] as { rol?: unknown; company_id?: unknown } | undefined;
      if (!miembro || typeof miembro.company_id !== "string") return null;
      const rol = rolLeido(miembro.rol);
      if (!rol) throw new ErrorDeDominio("base_no_disponible");
      const [proveedores, snapshot] = await Promise.all([
        consultar(SQL.proveedores, [miembro.company_id]),
        consultar(SQL.snapshot, []),
      ]);
      return {
        rol,
        lista: mapearLista(snapshot.rows[0]),
        proveedores: proveedores.rows.map((fila) => mapearProveedor(fila)),
      };
    },
    async guardarSnapshot(snapshot) {
      await conTransaccion(async (consulta) => {
        await consulta.query(SQL.insertarSnapshot, [snapshot.id, snapshot.fechaArchivo, snapshot.cargadoEn]);
        await insertarFilas(consulta, snapshot);
        await consulta.query("select releer_proveedores_69b($1::uuid, $2::timestamptz)", [
          snapshot.id,
          snapshot.cargadoEn,
        ]);
      });
    },
  };
}

function contexto(consulta: Consulta, companyId: string, rol: Rol): ContextoProveedores {
  return {
    companyId,
    rol,
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

async function insertarFilas(consulta: Consulta, snapshot: SnapshotNuevo): Promise<void> {
  for (let inicio = 0; inicio < snapshot.filas.length; inicio += LOTE) {
    const lote = snapshot.filas.slice(inicio, inicio + LOTE);
    const valores: string[] = [];
    const params: unknown[] = [];
    lote.forEach((fila, indice) => {
      const base = indice * 3;
      valores.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(snapshot.id, fila.rfc, fila.situacion);
    });
    await consulta.query(
      `insert into lista_69b_rows (snapshot_id, rfc, situacion) values ${valores.join(", ")} on conflict (snapshot_id, rfc, situacion) do nothing`,
      params,
    );
  }
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

function rolLeido(valor: unknown): Rol | null {
  return ROLES.find((rol) => rol === valor) ?? null;
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
