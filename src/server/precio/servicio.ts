import {
  CIFRA_NO_PUBLICADA,
  FRASE_SIN_CONSULTA,
  cerosDeProducto,
  centavosDesdePesos,
  existePasoAceptada,
  fechaYHoraEnMexico,
  presentarSuscripcion,
  relatoAceptada,
  relatoRecorrido,
  type LecturaSuscripcion,
  type TarifaVisible,
} from "../../dominio/precio";
import type { Sesion } from "../session/tipos";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { esCorreoOperador, operadoresDesdeEntorno } from "./operador";
import { repositorioPg, type FilaPrecio, type RepositorioPrecios } from "./repositorio";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DependenciasPrecio = {
  repositorio?: RepositorioPrecios;
  operadores?: ReadonlySet<string>;
  ahora?: () => Date;
};

export function esOperadorActual(
  sesion: Sesion | null | undefined,
  lista?: ReadonlySet<string>,
): boolean {
  if (!sesion?.usuario?.correo) return false;
  return esCorreoOperador(sesion.usuario.correo, lista ?? operadoresDesdeEntorno());
}

export async function leerTarifa(deps?: DependenciasPrecio): Promise<TarifaVisible> {
  try {
    const fila = await (deps?.repositorio ?? repositorioPg()).leerPrecio();
    return presentar(fila);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return tarifaSinConsulta();
    throw error;
  }
}

export async function leerSuscripcionDeLaSesion(
  sesion: Sesion | null | undefined,
  deps?: DependenciasPrecio,
): Promise<LecturaSuscripcion> {
  const companyId = sesion?.companyId;
  if (!companyId || !UUID.test(companyId)) return { tipo: "sin_empresa" };
  try {
    const fila = await (deps?.repositorio ?? repositorioPg()).leerSuscripcion(companyId);
    if (!fila) return { tipo: "ausente" };
    if (fila.companyId !== companyId) throw new ErrorDeDominio("base_no_disponible");
    if (fila.estado === "aceptada") {
      if (!fila.aceptadaEn) throw new ErrorDeDominio("base_no_disponible");
      return {
        tipo: "lista",
        estado: "aceptada",
        titulo: "Aceptada",
        relato: relatoAceptada(fila.aceptadaEn, fila.aceptadaPorNombre),
      };
    }
    return {
      tipo: "lista",
      estado: "recorrido",
      titulo: "Recorrido",
      relato: relatoRecorrido(fila.recorridoInicio, (deps?.ahora ?? reloj)()).texto,
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio) return { tipo: "no_disponible" };
    throw error;
  }
}

export async function publicarSuscripcion(
  sesion: Sesion | null | undefined,
  texto: string,
  deps?: DependenciasPrecio,
): Promise<TarifaVisible> {
  const actorId = exigirActor(sesion);
  if (!esOperadorActual(sesion, deps?.operadores)) throw new ErrorDeDominio("no_es_operador");
  const monto = centavosDesdePesos(typeof texto === "string" ? texto : "");
  if (!monto.ok) throw new ErrorDeDominio(monto.codigo);
  const fila = await (deps?.repositorio ?? repositorioPg()).publicar({
    centavos: monto.centavos,
    cuando: (deps?.ahora ?? reloj)(),
    actorId,
  });
  if (fila.centavos !== monto.centavos) throw new ErrorDeDominio("base_no_disponible");
  return presentar(fila);
}

export async function aceptarSuscripcion(
  sesion: Sesion | null | undefined,
  deps?: DependenciasPrecio,
): Promise<void> {
  const actorId = exigirActor(sesion);
  if (!esOperadorActual(sesion, deps?.operadores)) throw new ErrorDeDominio("no_es_operador");
  const companyId = sesion?.companyId;
  if (!companyId || !UUID.test(companyId)) throw new ErrorDeDominio("empresa_ausente");
  const repo = deps?.repositorio ?? repositorioPg();
  const precio = await repo.leerPrecio();
  if (precio.centavos === null) throw new ErrorDeDominio("precio_no_publicado");
  const actual = await repo.leerSuscripcion(companyId);
  if (!actual || actual.companyId !== companyId) throw new ErrorDeDominio("suscripcion_ausente");
  if (
    !existePasoAceptada({
      esOperador: true,
      montoPublicado: true,
      estado: actual.estado,
    })
  ) {
    throw new ErrorDeDominio("suscripcion_ya_aceptada");
  }
  const aceptada = await repo.aceptar({
    companyId,
    actorId,
    cuando: (deps?.ahora ?? reloj)(),
  });
  if (aceptada.companyId !== companyId || aceptada.estado !== "aceptada") {
    throw new ErrorDeDominio("base_no_disponible");
  }
}

export function presentar(fila: FilaPrecio): TarifaVisible {
  const ceros = cerosDeProducto();
  const publicada = fila.centavos !== null;
  return {
    disponible: true,
    suscripcion: presentarSuscripcion(fila.centavos),
    suscripcionPublicada: publicada,
    publicadaEl: fila.publicadoEn ? fechaYHoraEnMexico(fila.publicadoEn) : null,
    spei: CIFRA_NO_PUBLICADA,
    ...ceros,
  };
}

export function tarifaSinConsulta(): TarifaVisible {
  const ceros = cerosDeProducto();
  return {
    disponible: false,
    suscripcion: FRASE_SIN_CONSULTA,
    suscripcionPublicada: false,
    publicadaEl: null,
    spei: CIFRA_NO_PUBLICADA,
    ...ceros,
  };
}

function exigirActor(sesion: Sesion | null | undefined): string {
  const id = sesion?.usuario?.id;
  if (typeof id !== "string" || !UUID.test(id)) throw new ErrorDeDominio("sesion_ausente");
  return id;
}

function reloj(): Date {
  return new Date();
}
