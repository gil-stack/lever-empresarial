import {
  CIFRA_NO_PUBLICADA,
  FRASE_SIN_CONSULTA,
  cerosDeProducto,
  centavosDesdePesos,
  fechaYHoraEnMexico,
  presentarSuscripcion,
  relatoAceptada,
  relatoRecorrido,
  type LecturaSuscripcion,
  type TarifaVisible,
} from "../../dominio/precio";
import { exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { repositorioPg, type FilaPrecio, type RepositorioPrecios } from "./repositorio";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DependenciasPrecio = {
  repositorio?: RepositorioPrecios;
  ahora?: () => Date;
};

export async function leerTarifa(deps?: DependenciasPrecio): Promise<TarifaVisible> {
  try {
    const fila = await (deps?.repositorio ?? repositorioPg()).leerPrecio();
    return presentar(fila);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return tarifaSinConsulta();
    throw error;
  }
}

export async function leerSuscripcionDeLaEmpresa(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasPrecio,
): Promise<LecturaSuscripcion> {
  if (!ctx?.empresa) return { tipo: "sin_empresa" };
  const companyId = ctx.empresa.id;
  try {
    const fila = await (deps?.repositorio ?? repositorioPg()).leerSuscripcion({ ...ctx, empresa: ctx.empresa });
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

/**
 * Publicar el monto es irreversible: exige la capacidad de plataforma (solo con
 * sesión SOFIPO) y un segundo factor verificado en los últimos 30 minutos, como
 * las demás decisiones de Operación. La doble firma de precios es otro frente.
 */
export async function publicarSuscripcion(
  ctx: ContextoDeTenant | null | undefined,
  sesion: Pick<Sesion, "segundoFactor" | "superficie"> | null | undefined,
  texto: string,
  deps?: DependenciasPrecio,
): Promise<TarifaVisible> {
  const personal = exigirPersonal(ctx, "plataforma.precio.publicar");
  if (!sesion) throw new ErrorDeDominio("reautenticacion_requerida");
  exigirAutenticacionReciente(sesion, (deps?.ahora ?? reloj)());
  const monto = centavosDesdePesos(typeof texto === "string" ? texto : "");
  if (!monto.ok) throw new ErrorDeDominio(monto.codigo);
  const fila = await (deps?.repositorio ?? repositorioPg()).publicar(personal, {
    centavos: monto.centavos,
    cuando: (deps?.ahora ?? reloj)(),
  });
  if (fila.centavos !== monto.centavos) throw new ErrorDeDominio("base_no_disponible");
  return presentar(fila);
}

/** El personal del operador registra que el cliente aceptó. No es un acto de la empresa. */
export async function aceptarSuscripcion(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { companyId?: unknown },
  deps?: DependenciasPrecio,
): Promise<void> {
  const personal = exigirPersonal(ctx, "plataforma.suscripcion.aceptar");
  const companyId = typeof entrada?.companyId === "string" ? entrada.companyId : "";
  if (!UUID.test(companyId)) throw new ErrorDeDominio("empresa_ausente");
  const repo = deps?.repositorio ?? repositorioPg();
  const precio = await repo.leerPrecio();
  if (precio.centavos === null) throw new ErrorDeDominio("precio_no_publicado");
  const aceptada = await repo.aceptar(personal, {
    companyId,
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

function reloj(): Date {
  return new Date();
}
