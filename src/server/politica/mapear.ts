import { esUuid, type DatosPolitica } from "../../dominio/politica";
import { ErrorDeDominio } from "../session/error-de-dominio";

/**
 * La consulta devuelve un JSON con las columnas que la pantalla puede ver.
 * Cualquier otra clave —hash, connection string, un id de otra cuenta— se queda fuera.
 */

export function mapearPolitica(vista: unknown): DatosPolitica {
  const fila = comoObjeto(vista);
  if (fila.plazo === null || fila.plazo === undefined) {
    throw new ErrorDeDominio("politica_ausente");
  }
  const plazo = comoObjeto(fila.plazo);
  const dias = leerEntero(plazo.dias, false);
  const vencidos = leerEntero(plazo.vencidos, false);
  const umbral = leerEntero(fila.umbral, true);
  const sinCajon = leerEntero(fila.sinCajon, false);
  if (
    !esUuid(fila.companyId) ||
    typeof fila.rol !== "string" ||
    dias === undefined ||
    vencidos === undefined ||
    umbral === undefined ||
    sinCajon === undefined
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }

  return {
    companyId: fila.companyId,
    rol: fila.rol,
    diasComprobante: dias,
    maxVencidos: vencidos,
    umbralCentavos: umbral,
    personas: leerPersonas(fila.personas),
    categorias: leerCategorias(fila.categorias),
    cajones: leerCajones(fila.cajones),
    sinCajonCentavos: sinCajon,
  };
}

function leerPersonas(valor: unknown): DatosPolitica["personas"] {
  if (!Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor.map((item) => {
    const fila = comoObjeto(item);
    const dias = leerEntero(fila.dias, true);
    const vencidos = leerEntero(fila.vencidos, true);
    if (
      !esUuid(fila.userId) ||
      typeof fila.nombre !== "string" ||
      typeof fila.correo !== "string" ||
      typeof fila.rol !== "string" ||
      dias === undefined ||
      vencidos === undefined
    ) {
      throw new ErrorDeDominio("base_no_disponible");
    }
    return {
      userId: fila.userId,
      nombre: fila.nombre,
      correo: fila.correo,
      rol: fila.rol,
      diasComprobante: dias,
      maxVencidos: vencidos,
    };
  });
}

function leerCategorias(valor: unknown): DatosPolitica["categorias"] {
  if (!Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor.map((item) => {
    const fila = comoObjeto(item);
    const tope = leerEntero(fila.tope, true);
    if (!esUuid(fila.id) || typeof fila.nombre !== "string" || tope === undefined) {
      throw new ErrorDeDominio("base_no_disponible");
    }
    return { id: fila.id, nombre: fila.nombre, topeCentavos: tope };
  });
}

function leerCajones(valor: unknown): DatosPolitica["cajones"] {
  if (!Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor.map((item) => {
    const fila = comoObjeto(item);
    const saldo = leerEntero(fila.saldo, false);
    if (typeof fila.codigo !== "string" || typeof fila.nombre !== "string" || saldo === undefined) {
      throw new ErrorDeDominio("base_no_disponible");
    }
    return { codigo: fila.codigo, nombre: fila.nombre, saldoCentavos: saldo };
  });
}

function leerEntero(valor: unknown, permiteNulo: true): number | null | undefined;
function leerEntero(valor: unknown, permiteNulo: false): number | undefined;
function leerEntero(valor: unknown, permiteNulo: boolean): number | null | undefined {
  if (valor === null || valor === undefined) return permiteNulo ? null : undefined;
  if (typeof valor === "number" && Number.isSafeInteger(valor)) return valor;
  if (typeof valor === "string" && /^-?\d+$/.test(valor)) {
    const numero = Number(valor);
    if (Number.isSafeInteger(numero)) return numero;
  }
  return undefined;
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  if (typeof valor === "string") {
    try {
      return comoObjeto(JSON.parse(valor) as unknown);
    } catch (error) {
      if (error instanceof ErrorDeDominio) throw error;
      throw new ErrorDeDominio("base_no_disponible");
    }
  }
  if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }
  throw new ErrorDeDominio("base_no_disponible");
}
