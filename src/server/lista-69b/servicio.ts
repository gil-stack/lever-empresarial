import { validarRfcDeAlta } from "../../domain/rfc";
import {
  decodificarListado,
  decidirPago69b,
  fraseConteo,
  fraseDePago69b,
  fraseFechaArchivo,
  horaEnMexico,
  leerArchivo69b,
  leerPagina69b,
  puedeGuardarLista69b,
  puedeVerLista69b,
  type DecisionPago69b,
  type Fila69b,
} from "../../dominio/lista-69b";
import { esOperadorActual } from "../precio/servicio";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { origenSat, type OrigenListado } from "./descargar";
import { idDeCopia, repositorio69bPg, type Repositorio69b, type Snapshot69b } from "./repositorio";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const MENSAJE_RFC = {
  vacio: "Escribe el RFC.",
  longitud: "El RFC tiene 12 o 13 caracteres.",
  patron: "Ese RFC no cumple el patrón.",
  generico: "Ese RFC no es de un proveedor.",
} as const;

export type ResultadoConsulta =
  | { tipo: "vacia" }
  | { tipo: "invalida"; mensaje: string }
  | {
      tipo: "lista";
      rfc: string;
      frase: string;
      situaciones: string[];
      bloqueado: boolean;
      decision: DecisionPago69b;
    };

export type VistaLista69b = {
  puedeGuardar: boolean;
  fechaTexto: string | null;
  cargadoTexto: string | null;
  consultaTexto: string;
  contribuyentesTexto: string | null;
  rfcEscrito: string;
  errorRfc: string | null;
  resultado: Exclude<ResultadoConsulta, { tipo: "vacia" | "invalida" }> | null;
};

export type Dependencias69b = {
  repositorio?: Repositorio69b;
  origen?: OrigenListado;
  ahora?: () => Date;
  id?: () => string;
  esOperador?: boolean;
};

export async function leerVista69b(
  sesion: Sesion,
  rfcPedido: string | null,
  deps?: Dependencias69b,
): Promise<VistaLista69b> {
  const ahora = (deps?.ahora ?? reloj)();
  const repo = deps?.repositorio ?? repositorio69bPg();
  const snapshot = await repo.vigente();
  const consulta =
    rfcPedido === null ? ({ tipo: "vacia" } as const) : await decidirContra(rfcPedido, repo, snapshot);
  return {
    puedeGuardar: puedeGuardarLista69b(sesion.rol, deps?.esOperador ?? esOperadorActual(sesion)),
    fechaTexto: snapshot ? fraseFechaArchivo(snapshot.fechaArchivo) : null,
    cargadoTexto: snapshot ? horaEnMexico(snapshot.cargadoEn) : null,
    consultaTexto: horaEnMexico(ahora),
    contribuyentesTexto: snapshot ? fraseConteo(snapshot.contribuyentes) : null,
    rfcEscrito: rfcPedido ?? "",
    errorRfc: consulta.tipo === "invalida" ? consulta.mensaje : null,
    resultado: consulta.tipo === "lista" ? consulta : null,
  };
}

export function puedeAbrirLista69b(sesion: Sesion, esOperador = esOperadorActual(sesion)): boolean {
  return puedeVerLista69b(sesion.rol) || esOperador;
}

export async function consultarRfc(rfcTexto: string, deps?: Dependencias69b): Promise<ResultadoConsulta> {
  const repo = deps?.repositorio ?? repositorio69bPg();
  return decidirContra(rfcTexto, repo, await repo.vigente());
}

async function decidirContra(
  rfcTexto: string,
  repo: Repositorio69b,
  snapshot: Snapshot69b | null,
): Promise<ResultadoConsulta> {
  const validado = validarRfcDeAlta(rfcTexto);
  if (!validado.ok) return { tipo: "invalida", mensaje: MENSAJE_RFC[validado.error] };
  const situaciones = snapshot ? await repo.situaciones(snapshot.id, validado.rfc) : [];
  const decision = decidirPago69b({ hayArchivo: snapshot !== null, situaciones });
  return {
    tipo: "lista",
    rfc: validado.rfc,
    frase: fraseDePago69b(decision),
    situaciones: decision.situaciones,
    bloqueado: !decision.listaPermitePago,
    decision,
  };
}

export async function guardarListado69b(
  sesion: Sesion | null,
  deps?: Dependencias69b,
): Promise<{ fechaTexto: string; contribuyentesTexto: string }> {
  if (!sesion) throw new ErrorDeDominio("sesion_ausente");
  const esOperador = deps?.esOperador ?? esOperadorActual(sesion);
  if (!puedeGuardarLista69b(sesion.rol, esOperador)) throw new ErrorDeDominio("sin_permiso");

  const traido = await traerListado(deps?.origen ?? origenSat());
  const id = (deps?.id ?? idDeCopia)();
  if (!UUID.test(id)) throw new ErrorDeDominio("listado_irreconocible");
  const cargadoEn = (deps?.ahora ?? reloj)();
  await (deps?.repositorio ?? repositorio69bPg()).guardar({
    id,
    fechaArchivo: traido.fechaArchivo,
    cargadoEn,
    filas: traido.filas,
  });
  return {
    fechaTexto: fraseFechaArchivo(traido.fechaArchivo),
    contribuyentesTexto: fraseConteo(new Set(traido.filas.map((fila) => fila.rfc)).size),
  };
}

async function traerListado(origen: OrigenListado): Promise<{ fechaArchivo: string; filas: Fila69b[] }> {
  const html = await origen.leerPagina();
  const pagina = leerPagina69b(html);
  if (!pagina.ok) throw new ErrorDeDominio(pagina.codigo);
  const bytes = await origen.leerArchivo(pagina.urlListado);
  const archivo = leerArchivo69b(decodificarListado(bytes));
  if (!archivo.ok) throw new ErrorDeDominio(archivo.codigo);
  if (archivo.fechaArchivo !== pagina.fechaArchivo) throw new ErrorDeDominio("fechas_distintas");
  return { fechaArchivo: archivo.fechaArchivo, filas: archivo.filas };
}

function reloj(): Date {
  return new Date();
}
