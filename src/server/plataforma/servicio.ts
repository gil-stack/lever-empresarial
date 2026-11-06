import { randomUUID } from "node:crypto";

import { basePlataforma, exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDePersonal, type Actor } from "../bitacora/auditar";
import { darDeAltaEmpresa } from "../company/servicio";
import type { AltaEmpresaEntrada, Empresa } from "../company/tipos";
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

/** Alta de la empresa y, en otro acto, la invitación a su primer administrador. */
export async function darDeAltaClienteConAdministrador(
  ctx: ContextoDeTenant | null | undefined,
  entrada: {
    empresa: AltaEmpresaEntrada;
    demostracion: boolean;
    administrador: { nombre: string; correo: string };
  },
): Promise<{ empresa: Empresa; invitacion: InvitacionDeAlta }> {
  exigirPersonal(ctx, "plataforma.empresa.alta");
  const empresa = await darDeAltaEmpresa(ctx, entrada.empresa, { demostracion: entrada.demostracion });
  const invitacion = await invitarAdministrador(ctx, { companyId: empresa.id, razonSocial: empresa.razonSocial, ...entrada.administrador });
  return { empresa, invitacion };
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

/**
 * Pasa los correos de OPERADORES_PLATAFORMA a personal del operador con rol de
 * administración de plataforma. Cada persona recibe una invitación: si ya
 * tenía contraseña, confirma con ella; si no, fija la suya. Lo registra el
 * sistema. Después de correrla, la variable se borra del proyecto.
 */
export async function migrarPersonalDeVariable(correos: readonly string[]): Promise<
  { correo: string; resultado: "invitada" | "ya_era_personal"; invitacion?: InvitacionDeAlta }[]
> {
  const operadorId = await operadorUnico();
  const salida: { correo: string; resultado: "invitada" | "ya_era_personal"; invitacion?: InvitacionDeAlta }[] = [];
  for (const correo of correos) {
    const actor: Actor = {
      operadorId,
      companyId: null,
      actorTipo: "sistema",
      actorId: null,
      superficie: "sistema",
      peticionId: null,
      origen: "migracion_personal",
    };
    try {
      const emitida = await conContexto({ rol: "plataforma_sofipo", operadorId }, (consulta) =>
        emitirEnTransaccion(consulta, actor, {
          operadorId,
          nombre: correo.split("@")[0] ?? correo,
          correo,
          destino: { tipo: "personal", roles: ["administracion_plataforma"] },
          ahora: new Date(),
        }),
      );
      salida.push({ correo, resultado: "invitada", invitacion: { emitida, entrega: await entregarInvitacion(emitida, null) } });
    } catch (error) {
      if (error instanceof ErrorDeDominio && error.codigo === "personal_existente") {
        salida.push({ correo, resultado: "ya_era_personal" });
        continue;
      }
      throw error;
    }
  }
  return salida;
}

async function operadorUnico(): Promise<string> {
  const filas = await conContexto({ rol: "plataforma_cliente" }, (consulta) =>
    consulta.query("select id from operators order by alta_en, id"),
  );
  const ids = filas.rows.map((fila) => (fila as { id?: unknown }).id).filter((id): id is string => typeof id === "string");
  if (ids.length !== 1) throw new ErrorDeDominio("operador_ambiguo");
  return ids[0] as string;
}
