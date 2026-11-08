import { INVISIBLE } from "../control";
import { fechaDeCalendario } from "./validar";

/**
 * Lectura del CSV de la Lista de Personas Bloqueadas que carga Cumplimiento.
 *
 * Encabezado exacto: nombre,rfc,curp,tipo,fecha
 *   nombre  obligatorio, hasta 300 caracteres
 *   rfc     opcional: 12 caracteres (moral) o 13 (física)
 *   curp    opcional: 18 caracteres, solo personas físicas
 *   tipo    fisica | moral (se acepta «física»)
 *   fecha   opcional, AAAA-MM-DD: fecha de publicación o de notificación
 *
 * Cada archivo es la lista completa vigente; la carga anterior deja de ser la vigente.
 */

export type RenglonLpb = {
  nombre: string;
  rfc: string | null;
  curp: string | null;
  tipo: "fisica" | "moral";
  fecha: string | null;
};

export type LecturaLpb =
  | { ok: true; renglones: RenglonLpb[] }
  | { ok: false; codigo: "lpb_encabezado_invalido" | "lpb_vacia" | "lpb_demasiado_grande" | "lpb_renglon_invalido"; linea?: number };

export const MAXIMO_RENGLONES_LPB = 50_000;
const ENCABEZADO = ["nombre", "rfc", "curp", "tipo", "fecha"];
const RFC_MORAL = /^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$/;
const RFC_FISICA = /^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$/;
const CURP = /^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[A-Z0-9][0-9]$/;

export function leerListaBloqueadas(texto: string): LecturaLpb {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/);
  while (lineas.length > 0 && lineas[lineas.length - 1]?.trim() === "") lineas.pop();
  const encabezado = campos(lineas[0] ?? "")?.map((campo) => campo.trim().toLowerCase());
  if (!encabezado || encabezado.join(",") !== ENCABEZADO.join(",")) return { ok: false, codigo: "lpb_encabezado_invalido" };
  if (lineas.length < 2) return { ok: false, codigo: "lpb_vacia" };
  if (lineas.length - 1 > MAXIMO_RENGLONES_LPB) return { ok: false, codigo: "lpb_demasiado_grande" };

  const renglones: RenglonLpb[] = [];
  for (let indice = 1; indice < lineas.length; indice += 1) {
    const linea = indice + 1;
    const valores = campos(lineas[indice] ?? "");
    if (!valores || valores.length !== ENCABEZADO.length) return { ok: false, codigo: "lpb_renglon_invalido", linea };
    const [nombreCrudo, rfcCrudo, curpCrudo, tipoCrudo, fechaCruda] = valores.map((valor) => valor.trim());
    // El nombre se coteja letra por letra: con un carácter invisible (un tabulador, un U+00AD, un U+200B) el renglón se
    // rechaza antes de juntar los espacios, que lo volverían otro nombre («EVA\tRUIZ SOL» no es «EVA RUIZ SOL»).
    if (INVISIBLE.test(nombreCrudo ?? "")) return { ok: false, codigo: "lpb_renglon_invalido", linea };
    const nombre = (nombreCrudo ?? "").replace(/\s+/g, " ");
    const tipo = normalizarTipo(tipoCrudo ?? "");
    const rfc = rfcCrudo ? rfcCrudo.toUpperCase() : null;
    const curp = curpCrudo ? curpCrudo.toUpperCase() : null;
    const fecha = fechaCruda ? fechaCruda : null;
    if (nombre.length === 0 || nombre.length > 300 || !tipo) {
      return { ok: false, codigo: "lpb_renglon_invalido", linea };
    }
    if (rfc && !(tipo === "moral" ? RFC_MORAL : RFC_FISICA).test(rfc)) return { ok: false, codigo: "lpb_renglon_invalido", linea };
    if (curp && (tipo !== "fisica" || !CURP.test(curp))) return { ok: false, codigo: "lpb_renglon_invalido", linea };
    if (fecha && !fechaDeCalendario(fecha)) return { ok: false, codigo: "lpb_renglon_invalido", linea };
    renglones.push({ nombre, rfc, curp, tipo, fecha });
  }
  return { ok: true, renglones };
}

function normalizarTipo(valor: string): "fisica" | "moral" | null {
  const limpio = valor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (limpio === "fisica") return "fisica";
  if (limpio === "moral") return "moral";
  return null;
}

/** Campos de una línea CSV con comillas dobles; `null` si las comillas no cierran. */
function campos(linea: string): string[] | null {
  const salida: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i];
    if (entreComillas) {
      if (caracter === '"' && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (caracter === '"') {
        entreComillas = false;
      } else {
        actual += caracter;
      }
    } else if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === ",") {
      salida.push(actual);
      actual = "";
    } else {
      actual += caracter;
    }
  }
  if (entreComillas) return null;
  salida.push(actual);
  return salida;
}

export const ETIQUETA_SUJETO: Record<string, string> = {
  empresa: "La empresa",
  representante: "Representante",
  accionista: "Accionista",
  beneficiario: "Propietario real",
  contraparte: "Proveedor",
};

export const ETIQUETA_ESTADO_COINCIDENCIA: Record<string, string> = {
  pendiente: "Por revisar",
  confirmada: "Confirmada",
  falso_positivo: "Falso positivo",
  fuera_de_lista: "Ya no está en la lista",
};
