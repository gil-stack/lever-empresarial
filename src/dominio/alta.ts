import { regimenPorCodigo, usoPorCodigo } from "@/dominio/catalogos-fiscales";
import { normalizarRfc, tipoDeRfc, validarRfc } from "@/dominio/rfc";

export type AltaEmpresa = {
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
  confirmaRecorte: boolean;
};

export type CampoAlta = keyof AltaEmpresa | "nombre" | "correo" | "contrasena";

export type ErrorCampo = {
  campo: CampoAlta;
  mensaje: string;
};

export type CodigoRechazo = "segunda_razon_social" | "rfc_duplicado" | "libro" | "sesion";

export type EstadoAlta =
  | { tipo: "inicial" }
  | { tipo: "invalido"; errores: ErrorCampo[] }
  | { tipo: "rechazado"; codigo: CodigoRechazo };

export const ESTADO_INICIAL: EstadoAlta = { tipo: "inicial" };

const MENSAJE_RFC = {
  vacio: "Escribe el RFC.",
  longitud: "Son 12 caracteres para una persona moral y 13 para una persona física.",
  patron: "El RFC no tiene la forma de una clave del SAT.",
  fecha: "La fecha dentro del RFC no existe.",
  digito: "El dígito verificador no coincide.",
  generico: "El RFC genérico no abre una cuenta. Hace falta el de la razón social.",
} as const;

export function leerAlta(formData: FormData): AltaEmpresa {
  return {
    rfc: String(formData.get("rfc") ?? ""),
    razonSocial: String(formData.get("razonSocial") ?? ""),
    codigoPostal: String(formData.get("codigoPostal") ?? ""),
    regimen: String(formData.get("regimen") ?? ""),
    usoCfdi: String(formData.get("usoCfdi") ?? ""),
    confirmaRecorte: formData.get("confirmaRecorte") === "si",
  };
}

export function normalizarRazonSocial(valor: string): string {
  return valor.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function validarAlta(entrada: AltaEmpresa): { alta: AltaEmpresa; errores: ErrorCampo[] } {
  const alta: AltaEmpresa = {
    rfc: normalizarRfc(entrada.rfc),
    razonSocial: normalizarRazonSocial(entrada.razonSocial),
    codigoPostal: entrada.codigoPostal.trim(),
    regimen: entrada.regimen.trim(),
    usoCfdi: entrada.usoCfdi.trim(),
    confirmaRecorte: entrada.confirmaRecorte,
  };
  const errores: ErrorCampo[] = [];

  const motivoRfc = validarRfc(alta.rfc);
  if (motivoRfc) errores.push({ campo: "rfc", mensaje: MENSAJE_RFC[motivoRfc] });

  if (alta.razonSocial.length < 2 || alta.razonSocial.length > 254 || !/\p{L}/u.test(alta.razonSocial)) {
    errores.push({ campo: "razonSocial", mensaje: "Escribe la razón social tal como va a facturar." });
  }

  if (!/^\d{5}$/.test(alta.codigoPostal)) {
    errores.push({ campo: "codigoPostal", mensaje: "El código postal son cinco dígitos." });
  } else if (!prefijoPostalFiscal(alta.codigoPostal)) {
    errores.push({
      campo: "codigoPostal",
      mensaje: "Ese código postal no corresponde a un domicilio fiscal.",
    });
  }

  const regimen = regimenPorCodigo(alta.regimen);
  const tipo = tipoDeRfc(alta.rfc);
  if (!regimen) {
    errores.push({ campo: "regimen", mensaje: "Elige un régimen del catálogo." });
  } else if (tipo === "moral" && !regimen.moral) {
    errores.push({
      campo: "regimen",
      mensaje: "Ese régimen es de persona física. El RFC es de persona moral.",
    });
  } else if (tipo === "fisica" && !regimen.fisica) {
    errores.push({
      campo: "regimen",
      mensaje: "Ese régimen es de persona moral. El RFC es de persona física.",
    });
  }

  const uso = usoPorCodigo(alta.usoCfdi);
  if (!uso) {
    errores.push({ campo: "usoCfdi", mensaje: "Elige un uso de CFDI del catálogo." });
  } else if (tipo === "moral" && !uso.moral) {
    errores.push({ campo: "usoCfdi", mensaje: "Ese uso de CFDI no aplica a una persona moral." });
  } else if (tipo === "fisica" && !uso.fisica) {
    errores.push({ campo: "usoCfdi", mensaje: "Ese uso de CFDI no aplica a una persona física." });
  } else if (regimen && !uso.regimenes.includes(regimen.codigo)) {
    errores.push({ campo: "usoCfdi", mensaje: "Ese uso de CFDI no corresponde al régimen." });
  }

  if (!alta.confirmaRecorte) {
    errores.push({
      campo: "confirmaRecorte",
      mensaje: "Sin esta confirmación no se abre la cuenta.",
    });
  }

  return { alta, errores };
}

function prefijoPostalFiscal(cp: string): boolean {
  const prefijo = Number(cp.slice(0, 2));
  if (prefijo === 0 || prefijo === 17 || prefijo === 18 || prefijo === 19) return false;
  return prefijo >= 1 && prefijo <= 99;
}
