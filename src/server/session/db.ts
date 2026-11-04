import { ErrorDeDominio } from "./error-de-dominio";

export type Consulta = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type ResultadoPg = { rows: unknown[]; rowCount: number | null };

type ClientePg = {
  query: (sql: string, params?: unknown[]) => Promise<ResultadoPg>;
  release: () => void;
};

type PoolPg = {
  connect: () => Promise<ClientePg>;
  query: (sql: string, params?: unknown[]) => Promise<ResultadoPg>;
  end: () => Promise<void>;
  on: (evento: "error", fn: () => void) => void;
};

type OpcionesPool = {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
  idle_in_transaction_session_timeout: number;
  allowExitOnIdle: boolean;
  application_name: string;
  ssl?: { rejectUnauthorized: boolean };
};

type ConstructorPool = new (opciones: OpcionesPool) => PoolPg;

let pool: PoolPg | null = null;
let pendiente: Promise<PoolPg> | null = null;
let iniciada = false;
let epoca = 0;

/** Suelta el pool. La prueba de aislamiento lo usa antes de borrar su base. */
export async function cerrarConexion(): Promise<void> {
  epoca += 1;
  const actual = pool;
  const espera = pendiente;
  pool = null;
  pendiente = null;
  iniciada = false;
  const abiertos = new Set<PoolPg>();
  if (actual) abiertos.add(actual);
  if (espera) {
    try {
      abiertos.add(await espera);
    } catch {
      // La creación falló o ya cerró el pool al ver el cambio de época.
    }
  }
  for (const abierto of abiertos) {
    try {
      await abierto.end();
    } catch {
      // El driver puede citar la conexión. No se publica.
    }
  }
}

export function conexionIniciada(): boolean {
  return iniciada;
}

export async function consultar(
  sql: string,
  params: readonly unknown[] = [],
): Promise<{ rows: unknown[]; rowCount: number }> {
  try {
    const actual = await obtenerPool();
    const resultado = await actual.query(sql, [...params]);
    return { rows: resultado.rows, rowCount: resultado.rowCount ?? 0 };
  } catch (error) {
    throw traducirErrorDeBase(error);
  }
}

export async function conTransaccion<T>(fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  const cliente = await conectar();
  const consulta = comoConsulta(cliente);
  try {
    await consulta.query("begin");
    const resultado = await fn(consulta);
    await consulta.query("commit");
    return resultado;
  } catch (error) {
    try {
      await consulta.query("rollback");
    } catch {
      // El fallo del rollback puede citar la conexión. No se registra.
    }
    throw traducirErrorDeBase(error);
  } finally {
    try {
      cliente.release();
    } catch {
      // Igual que el rollback: se descarta para no publicar la conexión.
    }
  }
}

export function traducirErrorDeBase(error: unknown): Error {
  if (error instanceof ErrorDeDominio) return error;
  const codigo = campo(error, "code");
  const marca = `${campo(error, "constraint")} ${campo(error, "table")}`.toLowerCase();
  if (codigo === "23505") {
    if (marca.includes("suppliers_rfc")) return new ErrorDeDominio("proveedor_duplicado");
    if (marca.includes("rfc")) return new ErrorDeDominio("rfc_duplicado");
    if (marca.includes("correo")) return new ErrorDeDominio("correo_duplicado");
    if (marca.includes("token_hash")) return new ErrorDeDominio("sesion_duplicada");
    if (marca.includes("membership")) return new ErrorDeDominio("segunda_razon_social");
    if (marca.includes("cost_centers_nombre")) return new ErrorDeDominio("centro_duplicado");
    if (marca.includes("employees_un_usuario")) return new ErrorDeDominio("persona_repetida");
    if (marca.includes("policy_categories")) return new ErrorDeDominio("categoria_duplicada");
    if (marca.includes("supplier_clabes_una_vigente")) return new ErrorDeDominio("clabe_ya_vigente");
    if (marca.includes("lista_69b")) return new ErrorDeDominio("listado_irreconocible");
    if (marca.includes("polic") || marca.includes("drawer") || marca.includes("posting")) {
      return new ErrorDeDominio("politica_invalida");
    }
  }
  if (codigo === "23503" && marca.includes("policy_persons")) {
    return new ErrorDeDominio("persona_ajena");
  }
  if (codigo === "23514") {
    if (marca.includes("lista_69b")) return new ErrorDeDominio("listado_irreconocible");
    if (marca.includes("clabe")) return new ErrorDeDominio("clabe_invalida");
    if (marca.includes("baja")) return new ErrorDeDominio("baja_anterior");
    if (marca.includes("polic") || marca.includes("drawer") || marca.includes("posting")) {
      return new ErrorDeDominio("politica_invalida");
    }
  }
  if (campo(error, "code") === "P0001" || codigo === "23514") {
    const mensaje = campo(error, "message");
    const dePrecio = FRASES_DE_PRECIO[mensaje];
    if (dePrecio) return new ErrorDeDominio(dePrecio);
    if (CODIGOS_DE_FIRMA.has(mensaje)) return new ErrorDeDominio(mensaje);
    if (CODIGOS_DE_CLABE.has(mensaje)) return new ErrorDeDominio(mensaje);
    const deProveedor = FRASES_DE_PROVEEDOR[mensaje.trim()];
    if (deProveedor) return new ErrorDeDominio(deProveedor);
  }
  if (codigo === "23514" && marca.includes("lotes_prueba_dos_firmas")) {
    return new ErrorDeDominio("misma_persona_en_las_dos_firmas");
  }
  if (codigo === "23514" && marca.includes("lotes_prueba_es_prueba")) {
    return new ErrorDeDominio("dinero_real_fuera");
  }
  return new ErrorDeDominio("base_no_disponible");
}

const CODIGOS_DE_CLABE = new Set([
  "clabe_no_se_pisa",
  "clabe_ya_cerrada",
  "historial_de_clabe_no_se_borra",
  "auditoria_de_clabe_ausente",
]);

const FRASES_DE_PROVEEDOR: Readonly<Record<string, string>> = {
  auditoria_de_proveedor_ausente: "auditoria_no_disponible",
  constancia_ajena: "archivo_no_disponible",
  constancia_sin_proveedor: "archivo_no_disponible",
  proveedor_sin_clabe: "clabe_invalida",
  clabe_no_se_reescribe: "clabe_invalida",
  clabe_de_otra_empresa: "proveedor_ausente",
  rfc_de_proveedor_fijo: "proveedor_duplicado",
  pago_con_rfc_publicado: "listado_irreconocible",
  fecha_de_lista_distinta: "listado_irreconocible",
  situacion_distinta_de_la_copia: "listado_irreconocible",
  lectura_sin_copia: "listado_irreconocible",
  copia_69b_ausente: "listado_irreconocible",
  copia_69b_sin_filas: "listado_irreconocible",
  constancia_no_se_reescribe: "archivo_no_disponible",
};

const CODIGOS_DE_FIRMA = new Set([
  "misma_persona_en_las_dos_firmas",
  "dinero_real_fuera",
  "firma_en_un_solo_acto",
  "firmante_ajeno",
  "contador_no_libera",
  "sin_permiso_para_liberar",
  "empresa_no_operable",
  "contador_no_crea_pago",
  "sin_permiso_para_solicitar",
  "lote_ya_firmado",
  "entrada_invalida",
]);

const FRASES_DE_PRECIO: Readonly<Record<string, string>> = {
  "el monto de la suscripcion ya esta publicado": "precio_ya_publicado",
  "la suscripcion no pasa a aceptada sin monto publicado": "precio_no_publicado",
  "la suscripcion aceptada no regresa a recorrido": "suscripcion_ya_aceptada",
  "la suscripcion nace en recorrido": "suscripcion_invalida",
  "platform_pricing no se borra": "precio_protegido",
  "platform_pricing es una sola fila": "precio_protegido",
  "la suscripcion no se borra": "suscripcion_protegida",
  "el recorrido no se reescribe": "suscripcion_protegida",
  "la aceptacion no trae quien ni cuando": "suscripcion_invalida",
};

function comoConsulta(cliente: ClientePg): Consulta {
  return {
    query: async (sql, params = []) => {
      const resultado = await cliente.query(sql, [...params]);
      return { rows: resultado.rows, rowCount: resultado.rowCount ?? 0 };
    },
  };
}

async function conectar(): Promise<ClientePg> {
  try {
    const actual = await obtenerPool();
    return await actual.connect();
  } catch (error) {
    throw traducirErrorDeBase(error);
  }
}

function obtenerPool(): Promise<PoolPg> {
  if (pool) return Promise.resolve(pool);
  if (!pendiente) {
    const marca = epoca;
    pendiente = crearPool().then(
      (creado) => {
        if (marca !== epoca) {
          void creado.end().catch(() => undefined);
          throw new ErrorDeDominio("base_no_disponible");
        }
        pool = creado;
        iniciada = true;
        return creado;
      },
      (error) => {
        if (marca === epoca) pendiente = null;
        throw error;
      },
    );
  }
  return pendiente;
}

async function crearPool(): Promise<PoolPg> {
  const connectionString = leerConnectionString();
  try {
    const modulo = (await import("pg")) as { Pool?: ConstructorPool; default?: { Pool?: ConstructorPool } };
    const Pool = modulo.Pool ?? modulo.default?.Pool;
    if (!Pool) throw new ErrorDeDominio("base_no_disponible");
    const creado = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 10_000,
      allowExitOnIdle: true,
      application_name: "plataforma",
      ssl: esLocal(connectionString) ? undefined : { rejectUnauthorized: true },
    });
    creado.on("error", () => {
      // El driver puede adjuntar el connection string. No se registra.
    });
    return creado;
  } catch (error) {
    throw traducirErrorDeBase(error);
  }
}

function leerConnectionString(): string {
  const valor = process.env.DATABASE_URL;
  if (typeof valor !== "string" || valor.length === 0) {
    throw new ErrorDeDominio("base_no_configurada");
  }
  if (!valor.startsWith("postgres://") && !valor.startsWith("postgresql://")) {
    throw new ErrorDeDominio("base_no_configurada");
  }
  return valor;
}

function esLocal(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function campo(error: unknown, nombre: string): string {
  if (typeof error !== "object" || error === null || !(nombre in error)) return "";
  const valor = (error as Record<string, unknown>)[nombre];
  return typeof valor === "string" ? valor : "";
}
