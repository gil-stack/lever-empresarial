import { validarRfcDeAlta } from "../../domain/rfc";
import { regimenAplica, tipoDePersona, usoAplica } from "./catalogos";
import type { AltaEmpresaEntrada, EmpresaNormalizada } from "./tipos";
import { CONTROL } from "../../dominio/control";


export type CodigoAlta =
  | "rfc_invalido"
  | "rfc_generico"
  | "razon_social_invalida"
  | "razon_social_control"
  | "codigo_postal_invalido"
  | "regimen_invalido"
  | "uso_cfdi_invalido";

export type ResultadoAlta =
  | { ok: true; valor: EmpresaNormalizada }
  | { ok: false; codigo: CodigoAlta };

export function validarAlta(entrada: Partial<AltaEmpresaEntrada> | null | undefined): ResultadoAlta {
  const rfc = validarRfcDeAlta(entrada?.rfc);
  if (!rfc.ok) {
    return { ok: false, codigo: rfc.error === "generico" ? "rfc_generico" : "rfc_invalido" };
  }

  // Una identidad con un control invisible se rechaza con su propio aviso, no se limpia.
  if (typeof entrada?.razonSocial === "string" && CONTROL.test(entrada.razonSocial)) return { ok: false, codigo: "razon_social_control" };
  const razonSocial = normalizarRazon(entrada?.razonSocial);
  if (!razonSocial) return { ok: false, codigo: "razon_social_invalida" };

  const codigoPostal = normalizarCodigoPostal(entrada?.codigoPostal);
  if (!codigoPostalValido(codigoPostal)) return { ok: false, codigo: "codigo_postal_invalido" };

  const tipo = tipoDePersona(rfc.rfc);
  const regimen = codigo(entrada?.regimen);
  if (!regimenAplica(regimen, tipo)) return { ok: false, codigo: "regimen_invalido" };

  const usoCfdi = codigo(entrada?.usoCfdi);
  if (!usoAplica(usoCfdi, tipo, regimen)) return { ok: false, codigo: "uso_cfdi_invalido" };

  return { ok: true, valor: { rfc: rfc.rfc, razonSocial, codigoPostal, regimen, usoCfdi } };
}

function normalizarRazon(valor: unknown): string | null {
  if (typeof valor !== "string" || CONTROL.test(valor)) return null;
  const razon = valor.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (razon.length < 1 || razon.length > 254) return null;
  if (!/[\p{L}\p{N}]/u.test(razon)) return null;
  return razon;
}

function normalizarCodigoPostal(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.normalize("NFKC").trim().replace(/\s+/g, "");
}

function codigoPostalValido(cp: string): boolean {
  if (!/^\d{5}$/.test(cp)) return false;
  const prefijo = Number(cp.slice(0, 2));
  // 00 no se asigna. 17, 18 y 19 tampoco: el Estado de México empieza en 50.
  if (prefijo === 0 || prefijo === 17 || prefijo === 18 || prefijo === 19) return false;
  return prefijo >= 1 && prefijo <= 99;
}

function codigo(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.normalize("NFKC").trim().toUpperCase();
}
