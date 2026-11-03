import { TABLAS_CIMIENTO, type TablaCimiento } from "./esquema.ts";

/**
 * Nombres que puede usar la migración. El plan fija las tablas en inglés y
 * describe las columnas en español, así que la prueba acepta las dos formas.
 * Si la tabla ya existe y ninguna forma está, el esquema no cumple la
 * interfaz y la prueba falla: no se queda pendiente.
 */
const SINONIMOS: Record<TablaCimiento, Record<string, readonly string[]>> = {
  companies: {
    id: ["id"],
    rfc: ["rfc"],
    razonSocial: ["razon_social", "legal_name", "nombre_legal", "razon", "nombre"],
    codigoPostal: ["codigo_postal", "postal_code", "cp"],
    regimen: ["regimen", "regimen_fiscal", "tax_regime"],
    usoCfdi: ["uso_cfdi", "cfdi_use", "uso_de_cfdi"],
    alta: ["created_at", "hora_de_alta", "hora_alta", "alta_at", "created", "inserted_at"],
  },
  users: {
    id: ["id"],
    nombre: ["nombre", "name", "full_name", "nombre_completo"],
    correo: ["correo", "email", "correo_electronico"],
    passwordHash: [
      "password_hash",
      "contrasena_hash",
      "hash_contrasena",
      "password_digest",
      "hashed_password",
      "hash_de_contrasena",
      "password",
    ],
  },
  sessions: {
    id: ["id"],
    userId: ["user_id", "usuario_id"],
    tokenHash: ["token_hash", "hash_token", "session_token_hash"],
    vence: ["expires_at", "vencimiento", "vence_en", "expira_en", "expires"],
  },
  memberships: {
    id: ["id"],
    userId: ["user_id", "usuario_id"],
    companyId: ["company_id", "empresa_id"],
    rol: ["rol", "role", "papel"],
  },
  audit_events: {
    id: ["id"],
    companyId: ["company_id", "empresa_id"],
    actor: ["actor_id", "actor", "usuario_id", "user_id"],
    accion: ["accion", "action"],
    entidad: ["entidad", "entity", "entity_type", "tipo_entidad"],
    identificador: [
      "entity_id",
      "identificador",
      "entidad_id",
      "identificador_entidad",
      "target_id",
    ],
    hora: ["ocurrido_en", "created_at", "hora", "occurred_at", "created"],
  },
};

const OBLIGATORIOS: Record<TablaCimiento, readonly string[]> = {
  companies: ["id", "rfc", "razonSocial"],
  users: ["id"],
  sessions: ["userId", "tokenHash", "vence"],
  memberships: ["userId", "companyId"],
  audit_events: ["id", "companyId", "accion"],
};

const ETIQUETA: Record<string, string> = {
  id: "el id",
  rfc: "el RFC",
  razonSocial: "la razón social",
  userId: "el usuario",
  tokenHash: "el hash de la sesión",
  vence: "el vencimiento de la sesión",
  companyId: "la empresa",
  accion: "la acción de auditoría",
};

export type ColumnaFisica = {
  esquema: string;
  tabla: string;
  nombre: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  tieneDefault: boolean;
  generada: boolean;
};

export type TablaMapeada = {
  esquema: string;
  nombre: TablaCimiento;
  columnas: ColumnaFisica[];
  campos: Record<string, ColumnaFisica>;
};

export type Mapa = Record<TablaCimiento, TablaMapeada>;

export type FilaDeColumna = {
  esquema: string;
  tabla: string;
  nombre: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  tieneDefault: boolean;
  generada: boolean;
  identidad: boolean;
};

export function mapearColumnas(filas: FilaDeColumna[]): Mapa {
  const mapa = {} as Mapa;
  for (const tabla of TABLAS_CIMIENTO) {
    const deLaTabla = elegirEsquema(filas, tabla);
    const columnas = deLaTabla.map(normalizar);
    const campos = asignar(columnas, SINONIMOS[tabla]);
    const faltan = OBLIGATORIOS[tabla].filter((campo) => !campos[campo]);
    if (faltan.length > 0) {
      const nombres = columnas.map((columna) => columna.nombre);
      const detalle = faltan
        .map((campo) => {
          const que = ETIQUETA[campo] ?? campo;
          return `${que} (${SINONIMOS[tabla][campo]?.join(", ")})`;
        })
        .join("; ");
      throw new Error(
        `El esquema ya está, pero ${tabla} no cumple la interfaz de lectura. Falta ${detalle}. ` +
          `Columnas presentes: ${nombres.join(", ") || "ninguna"}.`,
      );
    }
    mapa[tabla] = {
      esquema: columnas[0]?.esquema ?? deLaTabla[0]?.esquema ?? "public",
      nombre: tabla,
      columnas,
      campos,
    };
  }
  return mapa;
}

function elegirEsquema(filas: FilaDeColumna[], tabla: string): FilaDeColumna[] {
  const coincidencias = filas.filter((fila) => fila.tabla === tabla);
  const esquemas = [...new Set(coincidencias.map((fila) => fila.esquema))];
  if (esquemas.length === 0) {
    throw new Error(
      `La migración nombra ${tabla}, pero al aplicarla no quedó creada en la base de prueba.`,
    );
  }
  const elegido = esquemas.includes("public")
    ? "public"
    : esquemas.length === 1
      ? esquemas[0]
      : null;
  if (!elegido) {
    throw new Error(
      `La tabla ${tabla} quedó en varios esquemas (${esquemas.join(", ")}). La prueba no elige uno.`,
    );
  }
  return coincidencias.filter((fila) => fila.esquema === elegido);
}

function normalizar(fila: FilaDeColumna): ColumnaFisica {
  return {
    esquema: fila.esquema,
    tabla: fila.tabla,
    nombre: fila.nombre,
    dataType: fila.dataType,
    udtName: fila.udtName,
    nullable: fila.nullable,
    tieneDefault: fila.tieneDefault || fila.identidad,
    generada: fila.generada,
  };
}

function asignar(
  columnas: ColumnaFisica[],
  sinonimos: Record<string, readonly string[]>,
): Record<string, ColumnaFisica> {
  const usados = new Set<string>();
  const campos: Record<string, ColumnaFisica> = {};
  for (const [logico, lista] of Object.entries(sinonimos)) {
    for (const candidato of lista) {
      const columna = columnas.find(
        (item) => item.nombre.toLowerCase() === candidato && !usados.has(item.nombre),
      );
      if (!columna) continue;
      usados.add(columna.nombre);
      campos[logico] = columna;
      break;
    }
  }
  return campos;
}

export function ident(nombre: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre)) {
    throw new Error(`Identificador no admitido en la prueba de aislamiento: ${nombre}`);
  }
  return `"${nombre}"`;
}

export function desde(tabla: TablaMapeada): string {
  return `${ident(tabla.esquema)}.${ident(tabla.nombre)}`;
}

export function col(alias: string, columna: ColumnaFisica): string {
  return `${alias}.${ident(columna.nombre)}`;
}

export function literal(valor: string | null, columna: ColumnaFisica): string {
  if (valor === null) return "null";
  if (esBytea(columna)) {
    if (/^[0-9a-f]+$/i.test(valor) && valor.length % 2 === 0) {
      return `decode('${valor.toLowerCase()}', 'hex')`;
    }
    return `convert_to(${texto(valor)}, 'UTF8')`;
  }
  return texto(valor);
}

export function predicadoToken(alias: string, columna: ColumnaFisica, token: string): string {
  const hex = exigirToken(token);
  const ref = col(alias, columna);
  if (esBytea(columna)) return `${ref} = decode('${hex}', 'hex')`;
  return `${ref} = ${texto(hex)}`;
}

export function predicadoId(alias: string, columna: ColumnaFisica, id: string): string {
  return `btrim(${col(alias, columna)}::text) = ${texto(exigirUuid(id))}`;
}

export function predicadoVigente(alias: string, columna: ColumnaFisica): string {
  const ref = col(alias, columna);
  const tipo = columna.dataType.toLowerCase();
  if (tipo === "text" || tipo.includes("character")) return `${ref}::timestamptz > now()`;
  return `${ref} > now()`;
}

export function exigirToken(token: string): string {
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error("El hash de sesión de la prueba tiene que ser hexadecimal de 64 caracteres.");
  }
  return token.toLowerCase();
}

export function exigirUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Id que no es UUID: ${id}`);
  }
  return id.toLowerCase();
}

function esBytea(columna: ColumnaFisica): boolean {
  return columna.dataType === "bytea" || columna.udtName === "bytea";
}

function texto(valor: string): string {
  return `'${valor.replaceAll("'", "''")}'`;
}
