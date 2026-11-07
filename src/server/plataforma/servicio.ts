import { randomUUID } from "node:crypto";

import { basePlataforma, exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDePersonal } from "../bitacora/auditar";
import { emitirEnTransaccion } from "../invitaciones/repositorio";
import { entregarInvitacion } from "../invitaciones/servicio";
import type { InvitacionEmitida, ResultadoDeEntrega } from "../invitaciones/tipos";
import { correoValido, normalizarCorreo } from "../session/validar";
import { resolverContexto, repositorioPg as tenenciaPg } from "../tenencia/resolver";

export type InvitacionDeAlta = { emitida: InvitacionEmitida; entrega: ResultadoDeEntrega };

/**
 * Hasta la fase 5 la SOFIPO opera desde un comando. El comando actúa como una
 * persona del personal, declarada por su correo, y deja su nombre en la
 * bitácora. Quien corre el comando ya tiene las credenciales de la base.
 */
export async function contextoDePersonal(correo: string): Promise<ContextoDeTenant> {
  const normalizado = normalizarCorreo(correo);
  if (!correoValido(normalizado)) throw new ErrorDeDominio("correo_invalido");
  const persona = await conContexto({ rol: "plataforma_cliente" }, async (consulta) => {
    const resultado = await consulta.query("select id, nombre, correo from identidad_por_correo($1)", [normalizado]);
    return resultado.rows[0] as { id?: unknown; nombre?: unknown; correo?: unknown } | undefined;
  });
  if (!persona || typeof persona.id !== "string" || typeof persona.nombre !== "string" || typeof persona.correo !== "string") {
    throw new ErrorDeDominio("no_es_operador");
  }
  const { ctx } = await resolverContexto(
    {
      sesion: {
        id: randomUUID(),
        venceEn: new Date(Date.now() + 60_000),
        usuario: { id: persona.id, nombre: persona.nombre, correo: persona.correo },
        // El comando corre con las credenciales directas de la base: es la puerta SOFIPO.
        superficie: "sofipo",
        segundoFactor: { metodo: "totp", en: new Date() },
      },
      empresaPedida: null,
      peticionId: null,
      superficie: "sofipo",
    },
    { repositorio: tenenciaPg() },
  );
  if (!ctx.personal) throw new ErrorDeDominio("no_es_operador");
  return { ...ctx, segundoFactor: "comando" };
}

export async function invitarAdministrador(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { companyId: string; razonSocial: string; nombre: string; correo: string },
): Promise<InvitacionDeAlta> {
  const personal = exigirPersonal(ctx, "plataforma.invitacion.emitir");
  const correo = normalizarCorreo(entrada.correo);
  if (!correoValido(correo)) throw new ErrorDeDominio("correo_invalido");
  const nombre = entrada.nombre.trim();
  if (nombre.length === 0 || nombre.length > 200) throw new ErrorDeDominio("nombre_invalido");
  const emitida = await conContexto(basePlataforma(personal, entrada.companyId), (consulta) =>
    emitirEnTransaccion(consulta, actorDePersonal(personal, entrada.companyId, "comando"), {
      operadorId: personal.personal.operadorId,
      nombre,
      correo,
      destino: { tipo: "empresa", companyId: entrada.companyId, roles: ["administrador"] },
      ahora: new Date(),
    }),
  );
  return { emitida, entrega: await entregarInvitacion(emitida, entrada.razonSocial) };
}

/** Lista de correos de la variable que se retira. Solo la lee la migración del personal. */
export function leerCorreosDeVariable(valor: string | undefined): string[] {
  if (!valor) return [];
  const correos = new Set<string>();
  for (const pieza of valor.split(",")) {
    const correo = normalizarCorreo(pieza);
    if (correoValido(correo)) correos.add(correo);
  }
  return [...correos];
}
