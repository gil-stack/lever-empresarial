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
  if (campo(error, "code") === "23505") {
    const marca = `${campo(error, "constraint")} ${campo(error, "table")}`.toLowerCase();
    if (marca.includes("rfc")) return new ErrorDeDominio("rfc_duplicado");
    if (marca.includes("correo")) return new ErrorDeDominio("correo_duplicado");
    if (marca.includes("token_hash")) return new ErrorDeDominio("sesion_duplicada");
    if (marca.includes("membership")) return new ErrorDeDominio("segunda_razon_social");
  }
  return new ErrorDeDominio("base_no_disponible");
}

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
