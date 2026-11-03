import { randomUUID } from "node:crypto";

/**
 * Auditoría del alta de la razón social.
 *
 * La sesión llama `registrarEvento(evento, consulta)` dentro de la misma
 * transacción que inserta la empresa. `consulta` ya es ese cliente: este
 * módulo no abre otra conexión y no lee variables de entorno. Otra conexión
 * sería otra transacción, y el alta podría quedar sin su auditoría.
 *
 * El evento dice quién (`actorId`), cuándo (`ocurridoEn`) y qué quedó
 * asentado: la acción, la entidad `companies` y el identificador de esa
 * empresa. La razón social, el RFC y el resto viven en `companies`.
 *
 * Lo que impide guardar un secreto es la forma del evento, no el recorrido
 * de patrones. Tienen que venir exactamente las seis claves, la acción y la
 * entidad están fijas, y los tres identificadores son UUID. El insert solo
 * escribe esas columnas. La tabla no tiene cuerpo libre. El recorrido de
 * patrones es una red de más: no sustituye esa lista blanca.
 *
 * Columnas de `audit_events`: id, company_id, actor_id, accion, entidad,
 * identificador, ocurrido_en. Solo hay insert.
 */

const INSERT_ALTA = `insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)`;

const ACCION_ALTA = "alta_empresa";
const ENTIDAD_EMPRESA = "companies";
const CLAVES_EVENTO = [
  "companyId",
  "actorId",
  "accion",
  "entidad",
  "identificador",
  "ocurridoEn",
] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANTE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const ESQUEMA_BASE =
  /(?:^|[\s"'`=(])(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\//i;
const USUARIO_EN_NEON = /@[a-z0-9.-]+\.neon\.tech\b/i;
const ANFITRION_DSN =
  /(?:^|[;\s])(?:host|server|data\s*source)\s*=\s*[^;\s]+/i;
const CLAVE_DSN = /(?:^|[;\s])(?:password|pwd)\s*=\s*[^;\s]+/i;
const ASIGNACION_SENSIBLE =
  /(?:^|[\s;,&])(?:password|passwd|pwd|secret|token|api_key|apikey|database_url|connection_string)\s*=\s*\S+/i;
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}/;
const BCRYPT = /\$2[aby]\$\d{2}\$/;
const LLAVE_PROVEEDOR = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/;

type EventoAlta = {
  companyId: string;
  actorId: string;
  accion: typeof ACCION_ALTA;
  entidad: typeof ENTIDAD_EMPRESA;
  identificador: string;
  ocurridoEn: Date | string;
};

type Consulta = {
  query: (sql: string, params: readonly unknown[]) => unknown;
};

function rechazar(codigo: string): never {
  throw new Error(`Auditoría rechazada: ${codigo}`);
}

function pasaLuhn(digitos: string): boolean {
  let suma = 0;
  let alternar = false;
  for (let indice = digitos.length - 1; indice >= 0; indice -= 1) {
    let digito = digitos.charCodeAt(indice) - 48;
    if (digito < 0 || digito > 9) return false;
    if (alternar) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    suma += digito;
    alternar = !alternar;
  }
  return suma % 10 === 0;
}

function contienePan(valor: string): boolean {
  const coincidencias = valor.match(new RegExp("\\d(?:[ -]?\\d){12,18}", "g"));
  if (!coincidencias) return false;
  return coincidencias.some((candidato) => {
    const digitos = candidato.replace(/\D/g, "");
    return digitos.length >= 13 && digitos.length <= 19 && pasaLuhn(digitos);
  });
}

function esConnectionString(valor: string): boolean {
  return (
    ESQUEMA_BASE.test(valor) ||
    USUARIO_EN_NEON.test(valor) ||
    (ANFITRION_DSN.test(valor) && CLAVE_DSN.test(valor))
  );
}

function contieneMaterialProhibido(valor: string): boolean {
  const candidatos = [valor];
  if (valor.includes("%")) {
    try {
      const decodificado = decodeURIComponent(valor);
      if (decodificado !== valor) candidatos.push(decodificado);
    } catch {
      // Un «%» suelto no es un connection string codificado.
    }
  }
  return candidatos.some(
    (candidato) =>
      esConnectionString(candidato) ||
      ASIGNACION_SENSIBLE.test(candidato) ||
      PEM.test(candidato) ||
      BEARER.test(candidato) ||
      BCRYPT.test(candidato) ||
      LLAVE_PROVEEDOR.test(candidato) ||
      contienePan(candidato),
  );
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function exigirUuid(valor: unknown): string {
  if (typeof valor !== "string") rechazar("evento_invalido");
  const limpio = valor.trim();
  if (!UUID.test(limpio)) rechazar("evento_invalido");
  return limpio;
}

function leerInstante(valor: unknown): Date {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) rechazar("reloj_invalido");
    return new Date(valor.getTime());
  }
  if (typeof valor !== "string" || !INSTANTE.test(valor)) rechazar("reloj_invalido");
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) rechazar("reloj_invalido");
  return instante;
}

function preparar(evento: unknown): {
  companyId: string;
  actorId: string;
  identificador: string;
  ocurridoEn: Date;
} {
  if (!esRegistro(evento)) rechazar("evento_invalido");

  for (const clave of Object.keys(evento)) {
    if (contieneMaterialProhibido(clave)) rechazar("evento_con_secreto");
    const valor = evento[clave];
    if (typeof valor === "string" && contieneMaterialProhibido(valor)) {
      rechazar("evento_con_secreto");
    }
  }

  const claves = Object.keys(evento);
  if (
    claves.length !== CLAVES_EVENTO.length ||
    CLAVES_EVENTO.some((clave) => !Object.hasOwn(evento, clave))
  ) {
    rechazar("evento_invalido");
  }

  if (evento.accion !== ACCION_ALTA || evento.entidad !== ENTIDAD_EMPRESA) {
    rechazar("evento_invalido");
  }

  return {
    companyId: exigirUuid(evento.companyId),
    actorId: exigirUuid(evento.actorId),
    identificador: exigirUuid(evento.identificador),
    ocurridoEn: leerInstante(evento.ocurridoEn),
  };
}

export async function registrarEvento(evento: EventoAlta, consulta: Consulta): Promise<void> {
  const fila = preparar(evento);
  if (!esRegistro(consulta) || typeof consulta.query !== "function") {
    rechazar("consulta_invalida");
  }

  await consulta.query(INSERT_ALTA, [
    randomUUID(),
    fila.companyId,
    fila.actorId,
    ACCION_ALTA,
    ENTIDAD_EMPRESA,
    fila.identificador,
    fila.ocurridoEn,
  ]);
}
