import { clabeValida } from "./clabe";
import { FRASE_ESTA_PANTALLA, FRASE_SIN_PAGO } from "./lista-69b";
import type { RolCuenta } from "./personas";
import { horaEnMexico } from "./reloj";
import { normalizarRfc, validarRfc } from "./rfc";

/**
 * Alta de proveedor en la consola de finanzas.
 *
 * Manda el RFC. «Amazon», «AMZN» y «Amazon México» no abren tres fichas.
 * La CLABE se guarda solo si el dígito cierra. La constancia es un PDF.
 * Si el RFC está en el archivo 69-B, o si ese archivo no está cargado,
 * el proveedor puede existir y el pago no. Esta fase no envía un SPEI.
 */

export const PESO_MAXIMO_CONSTANCIA = 8_000_000;
const TOPE_RAZON = 254;
const CONTROL = /[\u0000-\u001F\u007F]/;

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

export type CampoProveedor = "rfc" | "razonSocial" | "clabe" | "constancia";

export type ErrorCampoProveedor = {
  campo: CampoProveedor;
  mensaje: string;
};

export type CodigoRechazoProveedor =
  | "sin_permiso"
  | "proveedores_no_disponibles"
  | "sesion"
  | "sin_empresa"
  | "libro"
  | "archivo_no_disponible"
  | "listado_ilegible"
  | "listado_sin_fecha";

export type EstadoAltaProveedor =
  | { tipo: "inicial" }
  | { tipo: "invalido"; errores: ErrorCampoProveedor[] }
  | { tipo: "rechazado"; codigo: CodigoRechazoProveedor }
  | { tipo: "listo"; mensaje: string };

export const ESTADO_ALTA_INICIAL: EstadoAltaProveedor = { tipo: "inicial" };

export type MotivoPago = "en_lista" | "sin_archivo" | "fuera_de_lista";

export type DecisionPago = {
  botonPago: boolean;
  motivo: MotivoPago;
  situacion: string | null;
  fechaArchivo: string | null;
};

export type RelatoPago = {
  tono: "aviso" | "neutro";
  insignia: string;
  frase: string;
  detalle: string;
  /** Esta pantalla no pinta el control que envía dinero. */
  hayBoton: false;
};

export type ProveedorVisible = {
  id: string;
  rfc: string;
  razonSocial: string;
  clabe: string;
  constancia: string;
  decision: DecisionPago;
  leidaEn: string;
};

export type ListaVisible = {
  fechaArchivo: string;
  cargadoEn: string;
} | null;

const ORDEN: readonly CampoProveedor[] = ["rfc", "razonSocial", "clabe", "constancia"];

export function puedeVerProveedores(rol: RolCuenta | null | undefined): boolean {
  return rol === "administrador" || rol === "liberador" || rol === "contador";
}

/** El contador ve la ficha y no da de alta. El tarjetahabiente no entra. */
export function puedeDarDeAltaProveedor(rol: RolCuenta | null | undefined): boolean {
  return rol === "administrador" || rol === "liberador";
}

export function ordenarErroresProveedor(errores: readonly ErrorCampoProveedor[]): ErrorCampoProveedor[] {
  return [...errores].sort((a, b) => ORDEN.indexOf(a.campo) - ORDEN.indexOf(b.campo));
}

export function erroresDeAltaProveedor(entrada: {
  rfc: unknown;
  razonSocial: unknown;
  clabe: unknown;
  archivo: { nombre: string; tipo: string; peso: number } | null;
}): ErrorCampoProveedor[] {
  const errores: ErrorCampoProveedor[] = [];
  const rfc = motivoRfc(entrada.rfc);
  if (rfc) errores.push(rfc);
  const razon = motivoRazon(entrada.razonSocial);
  if (razon) errores.push(razon);
  if (!clabeValida(entrada.clabe).ok) {
    const error = errorDeCodigo("clabe_invalida");
    if (error) errores.push(error);
  }
  const archivo = motivoArchivo(entrada.archivo);
  if (archivo) errores.push(archivo);
  return errores;
}

export function validarConstancia(entrada: {
  nombre: unknown;
  bytes: Uint8Array;
}): { ok: true; nombre: string; bytes: Uint8Array } | { ok: false; codigo: CodigoConstancia } {
  if (!(entrada.bytes instanceof Uint8Array) || entrada.bytes.byteLength === 0) {
    return { ok: false, codigo: "constancia_vacia" };
  }
  if (entrada.bytes.byteLength > PESO_MAXIMO_CONSTANCIA) {
    return { ok: false, codigo: "constancia_peso" };
  }
  if (entrada.bytes.byteLength < 64) return { ok: false, codigo: "constancia_vacia" };
  const cabeza = String.fromCharCode(...entrada.bytes.subarray(0, 5));
  if (cabeza !== "%PDF-") return { ok: false, codigo: "constancia_tipo" };
  return { ok: true, nombre: nombreLimpio(typeof entrada.nombre === "string" ? entrada.nombre : ""), bytes: entrada.bytes };
}

type CodigoConstancia = "constancia_ausente" | "constancia_tipo" | "constancia_peso" | "constancia_vacia";

const CAMPO_DE_CODIGO: Readonly<Record<string, ErrorCampoProveedor>> = {
  rfc_vacio: { campo: "rfc", mensaje: "Escribe el RFC del proveedor." },
  rfc_longitud: { campo: "rfc", mensaje: "El RFC tiene 12 o 13 caracteres." },
  rfc_patron: { campo: "rfc", mensaje: "Ese RFC no tiene el patrón del SAT." },
  rfc_generico: { campo: "rfc", mensaje: "Ese RFC no es de un proveedor." },
  razon_vacia: { campo: "razonSocial", mensaje: "Escribe la razón social." },
  razon_control: { campo: "razonSocial", mensaje: "La razón social tiene un carácter que no se puede guardar." },
  razon_larga: { campo: "razonSocial", mensaje: "La razón social no cabe." },
  clabe_invalida: { campo: "clabe", mensaje: "La CLABE no cierra con el dígito. No se guarda." },
  constancia_ausente: { campo: "constancia", mensaje: "Falta la constancia de situación fiscal." },
  constancia_tipo: { campo: "constancia", mensaje: "La constancia tiene que ser un PDF." },
  constancia_peso: { campo: "constancia", mensaje: "Ese PDF pesa de más. No se guardó." },
  constancia_vacia: { campo: "constancia", mensaje: "Ese PDF está vacío." },
  proveedor_duplicado: { campo: "rfc", mensaje: "Ese RFC ya es un proveedor. No entra otra vez." },
};

export function errorDeCodigo(codigo: string): ErrorCampoProveedor | null {
  return CAMPO_DE_CODIGO[codigo] ?? null;
}

export function mensajeConstancia(codigo: CodigoConstancia): string {
  if (codigo === "constancia_ausente") return "Falta la constancia de situación fiscal.";
  if (codigo === "constancia_peso") return "Ese PDF pesa de más. No se guardó.";
  if (codigo === "constancia_vacia") return "Ese PDF está vacío.";
  return "La constancia tiene que ser un PDF.";
}

/**
 * El botón existe en el dato solo si hay archivo y el RFC no aparece.
 * La pantalla de esta fase no lo pinta: el envío queda fuera.
 */
export function decidirPago(lectura: { fechaArchivo: string | null; situaciones: readonly string[] }): DecisionPago {
  const situaciones = [...new Set(lectura.situaciones.map((valor) => valor.trim()).filter(Boolean))];
  if (!lectura.fechaArchivo) {
    return { botonPago: false, motivo: "sin_archivo", situacion: null, fechaArchivo: null };
  }
  if (situaciones.length > 0) {
    return {
      botonPago: false,
      motivo: "en_lista",
      situacion: situaciones.join(" · "),
      fechaArchivo: lectura.fechaArchivo,
    };
  }
  return { botonPago: true, motivo: "fuera_de_lista", situacion: null, fechaArchivo: lectura.fechaArchivo };
}

export function decisionGuardada(fila: { situacion: string | null; fechaArchivo: string | null }): DecisionPago {
  if (fila.situacion) {
    return { botonPago: false, motivo: "en_lista", situacion: fila.situacion, fechaArchivo: fila.fechaArchivo };
  }
  if (!fila.fechaArchivo) {
    return { botonPago: false, motivo: "sin_archivo", situacion: null, fechaArchivo: null };
  }
  return { botonPago: true, motivo: "fuera_de_lista", situacion: null, fechaArchivo: fila.fechaArchivo };
}

export function relatoDePago(decision: DecisionPago): RelatoPago {
  if (decision.motivo === "en_lista") {
    const fecha = decision.fechaArchivo ? fechaDeArchivo(decision.fechaArchivo) : "sin fecha";
    return {
      tono: "aviso",
      insignia: "En la lista 69-B",
      frase: FRASE_SIN_PAGO,
      detalle: `Situación publicada: ${decision.situacion ?? "la del archivo"}. Archivo del SAT del ${fecha}.`,
      hayBoton: false,
    };
  }
  if (decision.motivo === "sin_archivo") {
    return {
      tono: "aviso",
      insignia: "Sin archivo",
      frase: FRASE_SIN_PAGO,
      detalle: "Al darlo de alta no había archivo del artículo 69-B.",
      hayBoton: false,
    };
  }
  return {
    tono: "neutro",
    insignia: "Fuera de la lista",
    frase: FRASE_ESTA_PANTALLA,
    detalle: `El RFC no está en el archivo del ${fechaDeArchivo(decision.fechaArchivo ?? "")}.`,
    hayBoton: false,
  };
}

export function mensajeDeAlta(decision: DecisionPago): string {
  if (decision.motivo === "fuera_de_lista") {
    return `El proveedor quedó. ${FRASE_ESTA_PANTALLA}`;
  }
  return `El proveedor quedó. ${FRASE_SIN_PAGO}`;
}

export function fechaDeArchivo(iso: string): string {
  const corte = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!corte) return iso;
  const mes = MESES[Number(corte[2]) - 1];
  if (!mes) return iso;
  return `${Number(corte[3])} de ${mes} de ${corte[1]}`;
}

export function horaDeLectura(iso: string): string {
  const texto = horaEnMexico(new Date(iso));
  return texto || iso;
}

const SEPARADOR_SITUACION = " · ";

export type FichaReleida = {
  rfc: string;
  snapshotId: string | null;
  situacion: string | null;
  fechaArchivo: string | null;
  botonPago: boolean;
};

/**
 * Una copia nueva vuelve a leer las fichas.
 * Si el RFC entra, deja de estar fuera de la lista y el pago sigue apagado.
 * Quien se dio de alta sin archivo no recibe pago solo porque llegó una copia limpia.
 */
export function releerFichas<T extends FichaReleida>(
  fichas: readonly T[],
  copia: { id: string; fechaArchivo: string; filas: readonly { rfc: string; situacion: string }[] },
): T[] {
  const porRfc = new Map<string, string[]>();
  for (const fila of copia.filas) {
    const lista = porRfc.get(fila.rfc);
    if (lista) {
      if (!lista.includes(fila.situacion)) lista.push(fila.situacion);
    } else {
      porRfc.set(fila.rfc, [fila.situacion]);
    }
  }
  return fichas.map((ficha) => {
    const halladas = porRfc.get(ficha.rfc);
    if (halladas && halladas.length > 0) {
      const situacion = [...halladas].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(SEPARADOR_SITUACION);
      return {
        ...ficha,
        snapshotId: copia.id,
        situacion,
        fechaArchivo: copia.fechaArchivo,
        botonPago: false,
      };
    }
    if (ficha.snapshotId === null) return ficha;
    return {
      ...ficha,
      snapshotId: copia.id,
      situacion: null,
      fechaArchivo: copia.fechaArchivo,
      botonPago: true,
    };
  });
}

export const MENSAJE_RECHAZO: Record<CodigoRechazoProveedor, { titulo: string; texto: string }> = {
  sin_permiso: {
    titulo: "Tu rol no da de alta",
    texto: "El administrador y quien libera anotan al proveedor. El contador lo ve.",
  },
  proveedores_no_disponibles: {
    titulo: "Esta sección no abre con tu rol",
    texto: "El alta de proveedores es de la consola de finanzas. El teléfono del tarjetahabiente no la lleva.",
  },
  sesion: {
    titulo: "Hay que entrar",
    texto: "La sesión no está. Entra y vuelve a esta pantalla.",
  },
  sin_empresa: {
    titulo: "Falta la razón social",
    texto: "El proveedor pertenece a una empresa. Esta cuenta todavía no tiene RFC.",
  },
  libro: {
    titulo: "El libro no está disponible",
    texto: "No se guardó el proveedor. No hay nada que mostrar de la constancia.",
  },
  archivo_no_disponible: {
    titulo: "La constancia no se archivó",
    texto: "El proveedor no quedó. El archivo privado no recibió el PDF.",
  },
  listado_ilegible: {
    titulo: "El listado no se leyó",
    texto: "No se reemplazó el archivo 69-B. Sin una lectura clara no se abre el pago.",
  },
  listado_sin_fecha: {
    titulo: "El listado no trae fecha",
    texto: "No se guardó. La pantalla tiene que poder decir la fecha del archivo.",
  },
};

function motivoRfc(valor: unknown): ErrorCampoProveedor | null {
  if (typeof valor !== "string" || normalizarRfc(valor).length === 0) return errorDeCodigo("rfc_vacio");
  const motivo = validarRfc(valor);
  if (motivo === null) return null;
  if (motivo === "longitud") return errorDeCodigo("rfc_longitud");
  if (motivo === "generico") return errorDeCodigo("rfc_generico");
  if (motivo === "vacio") return errorDeCodigo("rfc_vacio");
  return errorDeCodigo("rfc_patron");
}

function motivoRazon(valor: unknown): ErrorCampoProveedor | null {
  if (typeof valor !== "string") return errorDeCodigo("razon_vacia");
  const razon = valor.trim();
  if (razon.length === 0) return errorDeCodigo("razon_vacia");
  if (CONTROL.test(razon)) return errorDeCodigo("razon_control");
  if (razon.length > TOPE_RAZON) return errorDeCodigo("razon_larga");
  return null;
}

function motivoArchivo(archivo: { nombre: string; tipo: string; peso: number } | null): ErrorCampoProveedor | null {
  if (!archivo || (archivo.peso === 0 && archivo.nombre.trim() === "")) {
    return { campo: "constancia", mensaje: mensajeConstancia("constancia_ausente") };
  }
  if (archivo.peso === 0 || archivo.peso < 64) {
    return { campo: "constancia", mensaje: mensajeConstancia("constancia_vacia") };
  }
  if (archivo.peso > PESO_MAXIMO_CONSTANCIA) {
    return { campo: "constancia", mensaje: mensajeConstancia("constancia_peso") };
  }
  const tipo = archivo.tipo.toLowerCase();
  const nombre = archivo.nombre.toLowerCase();
  const parecePdf = tipo === "application/pdf" || tipo === "application/octet-stream" || tipo === "" || nombre.endsWith(".pdf");
  if (!parecePdf) return { campo: "constancia", mensaje: mensajeConstancia("constancia_tipo") };
  return null;
}

function nombreLimpio(nombre: string): string {
  const base = nombre.split(/[/\\]/).pop() ?? "";
  const limpio = base.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 180);
  return limpio.length > 0 ? limpio : "constancia.pdf";
}

export function razonNormalizada(valor: string): string {
  return valor.trim();
}

export function rfcDeProveedor(valor: string): string | null {
  if (validarRfc(valor) !== null) return null;
  return normalizarRfc(valor);
}
