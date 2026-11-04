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
  type DecisionPago69b,
  type Fila69b,
} from "../../dominio/lista-69b";
import { exigirPersonal, exigirSesion, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
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
};

export async function leerVista69b(
  ctx: ContextoDeTenant | null | undefined,
  rfcPedido: string | null,
  deps?: Dependencias69b,
): Promise<VistaLista69b> {
  const conSesion = exigirSesion(ctx);
  if (!puede(conSesion, "cliente.lista69b.ver") && !puede(conSesion, "plataforma.lista69b.cargar")) {
    throw new ErrorDeDominio("sin_permiso");
  }
  const ahora = (deps?.ahora ?? reloj)();
  const repo = deps?.repositorio ?? repositorio69bPg();
  const snapshot = await repo.vigente();
  const consulta =
    rfcPedido === null ? ({ tipo: "vacia" } as const) : await decidirContra(rfcPedido, repo, snapshot);
  return {
    puedeGuardar: puede(conSesion, "plataforma.lista69b.cargar"),
    fechaTexto: snapshot ? fraseFechaArchivo(snapshot.fechaArchivo) : null,
    cargadoTexto: snapshot ? horaEnMexico(snapshot.cargadoEn) : null,
    consultaTexto: horaEnMexico(ahora),
    contribuyentesTexto: snapshot ? fraseConteo(snapshot.contribuyentes) : null,
    rfcEscrito: rfcPedido ?? "",
    errorRfc: consulta.tipo === "invalida" ? consulta.mensaje : null,
    resultado: consulta.tipo === "lista" ? consulta : null,
  };
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

/** La lista es de la plataforma: la carga solo el personal del operador. */
export async function guardarListado69b(
  ctx: ContextoDeTenant | null | undefined,
  deps?: Dependencias69b,
): Promise<{ fechaTexto: string; contribuyentesTexto: string }> {
  const personal = exigirPersonal(ctx, "plataforma.lista69b.cargar");

  const traido = await traerListado(deps?.origen ?? origenSat());
  const id = (deps?.id ?? idDeCopia)();
  if (!UUID.test(id)) throw new ErrorDeDominio("listado_irreconocible");
  const cargadoEn = (deps?.ahora ?? reloj)();
  await (deps?.repositorio ?? repositorio69bPg()).guardar(personal, {
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
