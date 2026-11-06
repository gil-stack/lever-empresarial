/**
 * Forma compartida de un evento de auditoría.
 *
 * La tabla no tiene cuerpo. El evento solo puede traer las seis claves, los
 * identificadores son UUID y ningún valor puede arrastrar un secreto, un PAN
 * o un connection string. Quien registra un alta de empresa o un hecho del
 * maestro usa estas comprobaciones; no las copia a medias.
 */

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

export const CLAVES_EVENTO = [
  "companyId",
  "actorId",
  "accion",
  "entidad",
  "identificador",
  "ocurridoEn",
] as const;

export function rechazarAuditoria(codigo: string): never {
  throw new Error(`Auditoría rechazada: ${codigo}`);
}

export function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export function exigirUuid(valor: unknown): string {
  if (typeof valor !== "string") rechazarAuditoria("evento_invalido");
  const limpio = valor.trim();
  if (!UUID.test(limpio)) rechazarAuditoria("evento_invalido");
  return limpio;
}

export function leerInstante(valor: unknown): Date {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) rechazarAuditoria("reloj_invalido");
    return new Date(valor.getTime());
  }
  if (typeof valor !== "string" || !INSTANTE.test(valor)) rechazarAuditoria("reloj_invalido");
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) rechazarAuditoria("reloj_invalido");
  return instante;
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

// Un UUID completo, sin pegarse a otro carácter hexadecimal.
const UUID_EN_TEXTO = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;

/**
 * Un UUID no es una tarjeta. Sus grupos separados por guiones pueden juntar 13
 * o más dígitos que pasan Luhn (0.2% de los UUID aleatorios), así que se quitan
 * antes de buscar la racha. Una tarjeta escrita con espacios o guiones de 4 en 4
 * se sigue rechazando.
 */
function contienePan(valor: string): boolean {
  const coincidencias = valor.replace(UUID_EN_TEXTO, " ").match(new RegExp("\\d(?:[ -]?\\d){12,18}", "g"));
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

export function contieneMaterialProhibido(valor: string): boolean {
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

/** Revisa claves y valores de texto. No copia el material al error. */
export function rechazarSiHayMaterial(evento: Record<string, unknown>): void {
  for (const clave of Object.keys(evento)) {
    if (contieneMaterialProhibido(clave)) rechazarAuditoria("evento_con_secreto");
    const valor = evento[clave];
    if (typeof valor === "string" && contieneMaterialProhibido(valor)) {
      rechazarAuditoria("evento_con_secreto");
    }
  }
}

export function clavesExactas(evento: Record<string, unknown>): boolean {
  const claves = Object.keys(evento);
  return (
    claves.length === CLAVES_EVENTO.length &&
    CLAVES_EVENTO.every((clave) => Object.hasOwn(evento, clave))
  );
}
