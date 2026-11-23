import { randomInt, randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hoyEnMexico, textoOperativo, uuidValido } from "../../dominio/operacion";
import { validarAlta } from "../company/validar";
import { leerConfigEfevoo } from "../efevoo/config";
import { darDeAltaEnEfevoo } from "../efevoo/operacion";
import { ErrorEfevoo } from "../efevoo/errores";
import { correoValido, normalizarCorreo } from "../session/validar";
import { invitarPrimerAdministrador, type ResultadoInvitacionOperacion } from "./invitaciones";
import { exigirEnOperacion } from "./permisos";

/**
 * Alta rápida de clientes de prueba (0050). Para probar el portal y las tarjetas sin el alta regulada: el cliente nace
 * activo, marcado como de prueba para siempre, con su primer administrador invitado y dado de alta en el procesador.
 *
 * Solo existe mientras el procesador está en su ambiente de pruebas (sandbox): con las llaves reales desaparece. Solo
 * Administración de la plataforma, y la base lo vuelve a exigir en su puerta (cliente_de_prueba_alta), que también deja
 * el evento en la bitácora. El alta regulada no cambia.
 */

/** Datos fiscales de relleno: régimen general de personas morales, gastos en general, CP de la CDMX. */
const FISCALES = { codigoPostal: "06600", regimen: "601", usoCfdi: "G03" } as const;
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ALFANUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

export function altaRapidaDisponible(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const { config } = leerConfigEfevoo(env);
  return config?.ambiente === "sandbox";
}

/** Un RFC de persona moral con el patrón del SAT para un cliente de prueba: «P» + dos letras, la fecha de hoy y homoclave al azar. */
export function rfcDePrueba(ahora: Date = new Date(), azar: (tope: number) => number = randomInt): string {
  const [anio, mes, dia] = hoyEnMexico(ahora).split("-");
  const letra = () => LETRAS[azar(LETRAS.length)];
  const alfanum = () => ALFANUM[azar(ALFANUM.length)];
  return `P${letra()}${letra()}${anio!.slice(2)}${mes}${dia}${alfanum()}${alfanum()}${azar(10)}`;
}

export type EntradaAltaRapida = { razonSocial?: unknown; rfc?: unknown; nombre?: unknown; correo?: unknown };

export type ResultadoAltaRapida = {
  companyId: string;
  invitacion: ResultadoInvitacionOperacion;
  /** Si quedó dada de alta en el procesador; si no, el código para el aviso (se puede repetir desde la ficha). */
  tarjetas: { vinculada: true } | { vinculada: false; codigo: string };
};

type Dependencias = {
  env?: Readonly<Record<string, string | undefined>>;
  invitar?: typeof invitarPrimerAdministrador;
  vincular?: (ctx: ContextoDePersonal, companyId: string) => Promise<void>;
};

export async function darDeAltaClienteDePrueba(
  ctx: ContextoDePersonal,
  entrada: EntradaAltaRapida,
  deps: Dependencias = {},
): Promise<ResultadoAltaRapida> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!altaRapidaDisponible(deps.env)) throw new ErrorDeDominio("alta_rapida_no_disponible");
  const nombre = textoOperativo(entrada.nombre, 200);
  if (!nombre) throw new ErrorDeDominio("dato_invalido_nombre");
  const correo = normalizarCorreo(typeof entrada.correo === "string" ? entrada.correo : "");
  if (!correoValido(correo)) throw new ErrorDeDominio("dato_invalido_correo");
  const escrito = typeof entrada.rfc === "string" ? entrada.rfc.trim() : "";

  const companyId = await crearEnLaBase(ctx, { razonSocial: entrada.razonSocial, rfc: escrito, nombre, correo });
  const invitacion = await (deps.invitar ?? invitarPrimerAdministrador)(ctx, { companyId, nombre, correo, vista: "" });
  const tarjetas = await vincularEnTarjetas(ctx, companyId, deps.vincular);
  return { companyId, invitacion, tarjetas };
}

async function crearEnLaBase(
  ctx: ContextoDePersonal,
  datos: { razonSocial: unknown; rfc: string; nombre: string; correo: string },
): Promise<string> {
  // Sin RFC escrito se inventa uno; si choca con otro (casi imposible), se intenta con otro.
  for (let intento = 0; intento < 3; intento += 1) {
    const razonSocial = typeof datos.razonSocial === "string" ? datos.razonSocial : "";
    const validada = validarAlta({ ...FISCALES, razonSocial, rfc: datos.rfc || rfcDePrueba() });
    if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
    const id = randomUUID();
    try {
      await conContexto(basePlataforma(ctx, id), (consulta) =>
        consulta.query("select cliente_de_prueba_alta($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
          id,
          validada.valor.rfc,
          validada.valor.razonSocial,
          validada.valor.codigoPostal,
          validada.valor.regimen,
          validada.valor.usoCfdi,
          datos.nombre,
          datos.correo,
          ctx.peticionId,
        ]),
      );
      return id;
    } catch (error) {
      if (error instanceof ErrorDeDominio && error.codigo === "rfc_duplicado" && !datos.rfc) continue;
      throw error;
    }
  }
  throw new ErrorDeDominio("rfc_duplicado");
}

async function vincularEnTarjetas(
  ctx: ContextoDePersonal,
  companyId: string,
  vincular?: Dependencias["vincular"],
): Promise<ResultadoAltaRapida["tarjetas"]> {
  try {
    if (vincular) await vincular(ctx, companyId);
    else {
      const hecha = await darDeAltaEnEfevoo(ctx, { companyId, llave: randomUUID() });
      if (hecha.estado !== "confirmada") return { vinculada: false, codigo: `operacion_${hecha.estado}` };
    }
    return { vinculada: true };
  } catch (error) {
    if (error instanceof ErrorEfevoo || error instanceof ErrorDeDominio) return { vinculada: false, codigo: error.codigo };
    return { vinculada: false, codigo: "efevoo_no_disponible" };
  }
}

export async function archivarClienteDePrueba(ctx: ContextoDePersonal, companyId: unknown): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(companyId)) throw new ErrorDeDominio("cliente_ausente");
  await conContexto(basePlataforma(ctx, companyId), (consulta) =>
    consulta.query("select cliente_de_prueba_archivar($1, $2)", [companyId, ctx.peticionId]),
  );
}
