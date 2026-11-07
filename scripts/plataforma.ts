/**
 * Comando del personal del operador, hasta que la fase 5 abra su portal.
 *
 *   npx tsx scripts/plataforma.ts personal:migrar-variable
 *   npx tsx scripts/plataforma.ts empresa:alta --personal <correo> --rfc <RFC> --razon <texto>
 *       --cp <12345> --regimen <601> --uso <G03> --admin-nombre <texto> --admin-correo <correo>
 *       [--demostracion] [--mostrar-enlace]
 *   npx tsx scripts/plataforma.ts suscripcion:aceptar --personal <correo> --empresa <uuid>
 *   npx tsx scripts/plataforma.ts personal:rol --correo <correo> --rol <rol> --motivo <texto> [--quitar]
 *
 * Lee DATABASE_URL y no la imprime. Cada acto queda en la bitácora con el
 * personal que lo hizo y el origen «comando». El enlace de una invitación es
 * de un solo uso y es de la persona invitada: solo se imprime con
 * --mostrar-enlace, cuando el correo no salió.
 *
 * personal:rol da o quita un rol del personal cuando nadie más administra al
 * personal (nadie se da un rol a sí mismo por pantalla). Corre con
 * DATABASE_URL_UNPOOLED, la conexión directa de las migraciones: la función
 * personal_rol_por_comando (0028) solo la ejecuta la dueña de la base, nunca la
 * aplicación. Queda en la bitácora como acto del sistema con origen «comando» y
 * el motivo escrito. Si otra persona administra al personal, la base pide usar
 * la pantalla Personal.
 */
import { Client } from "pg";

import { esRolPlataforma, ROLES_PLATAFORMA } from "../src/nucleo/capacidades";
import { cerrarConexion } from "../src/nucleo/db";
import { ErrorDeDominio } from "../src/nucleo/error-de-dominio";
import { enlaceDeInvitacion, urlPublica } from "../src/server/invitaciones/correo";
import {
  contextoDePersonal,
  darDeAltaClienteConAdministrador,
  leerCorreosDeVariable,
  migrarPersonalDeVariable,
  type InvitacionDeAlta,
} from "../src/server/plataforma/servicio";
import { aceptarSuscripcion } from "../src/server/precio/servicio";

async function principal(argv: string[]): Promise<void> {
  const [orden, ...resto] = argv;
  const opciones = leerOpciones(resto);
  if (orden === "personal:migrar-variable") {
    const correos = leerCorreosDeVariable(process.env.OPERADORES_PLATAFORMA);
    if (correos.length === 0) {
      console.log("OPERADORES_PLATAFORMA no trae correos. No hay nada que migrar.");
      return;
    }
    for (const fila of await migrarPersonalDeVariable(correos)) {
      console.log(`${fila.correo}: ${fila.resultado === "invitada" ? "invitada" : "ya era personal"}`);
      if (fila.invitacion) informarEntrega(fila.invitacion, Boolean(opciones["mostrar-enlace"]));
    }
    console.log("Cuando cada persona acepte, borra OPERADORES_PLATAFORMA de las variables del proyecto.");
    return;
  }
  if (orden === "empresa:alta") {
    const ctx = await contextoDePersonal(exigir(opciones, "personal"));
    const { empresa, invitacion } = await darDeAltaClienteConAdministrador(ctx, {
      empresa: {
        rfc: exigir(opciones, "rfc"),
        razonSocial: exigir(opciones, "razon"),
        codigoPostal: exigir(opciones, "cp"),
        regimen: exigir(opciones, "regimen"),
        usoCfdi: exigir(opciones, "uso"),
      },
      demostracion: Boolean(opciones.demostracion),
      administrador: { nombre: exigir(opciones, "admin-nombre"), correo: exigir(opciones, "admin-correo") },
    });
    console.log(`Empresa ${empresa.razonSocial} (${empresa.rfc}) dada de alta: ${empresa.id}`);
    informarEntrega(invitacion, Boolean(opciones["mostrar-enlace"]));
    return;
  }
  if (orden === "suscripcion:aceptar") {
    const ctx = await contextoDePersonal(exigir(opciones, "personal"));
    await aceptarSuscripcion(ctx, { companyId: exigir(opciones, "empresa") });
    console.log("La suscripción quedó aceptada.");
    return;
  }
  if (orden === "personal:rol") {
    const correo = exigir(opciones, "correo");
    const rol = exigir(opciones, "rol");
    if (!esRolPlataforma(rol)) throw new Error(`Rol desconocido. Usa uno de: ${ROLES_PLATAFORMA.join(", ")}.`);
    const quitar = Boolean(opciones.quitar);
    const cambio = await rolPorComando({ correo, rol, quitar, motivo: exigir(opciones, "motivo") });
    if (cambio) console.log(`${quitar ? "Se quitó" : "Se asignó"} el rol ${rol} a ${correo}. Quedó en la bitácora como acto del comando.`);
    else console.log(`${correo} ${quitar ? "no tenía" : "ya tenía"} el rol ${rol}. No cambió nada.`);
    return;
  }
  throw new Error("Orden desconocida. Usa personal:migrar-variable, empresa:alta, suscripcion:aceptar o personal:rol.");
}

const RECHAZOS_DE_ROL: Readonly<Record<string, string>> = {
  persona_ausente: "No hay una persona activa del personal con ese correo.",
  rol_por_pantalla: "Otra persona del personal administra al personal: el rol se da en la pantalla Personal, con su confirmación de identidad.",
  roles_incompatibles: "Cumplimiento no se junta con Auditoría ni con Originación (50ª).",
  personal_sin_administracion: "El personal no se queda sin administración: este comando no quita ese rol.",
  motivo_invalido: "El motivo va en una sola línea, de 10 a 500 caracteres.",
  rol_invalido: "Rol desconocido.",
};

/**
 * Llama a personal_rol_por_comando con la conexión directa. Un rechazo de la base sale con su
 * frase; cualquier otro error, solo con su clase. Nunca se imprime el connection string.
 */
async function rolPorComando(entrada: { correo: string; rol: string; quitar: boolean; motivo: string }): Promise<boolean> {
  const cliente = new Client({ connectionString: urlDirecta() });
  await cliente.connect();
  try {
    const resultado = await cliente.query("select personal_rol_por_comando($1, $2, $3, $4) as cambio", [
      entrada.correo,
      entrada.rol,
      entrada.quitar,
      entrada.motivo,
    ]);
    return (resultado.rows[0] as { cambio?: unknown } | undefined)?.cambio === true;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message.trim() : "";
    const rechazo = RECHAZOS_DE_ROL[mensaje];
    if (rechazo) throw new Error(`No se hizo: ${rechazo}`);
    if ((error as { code?: unknown }).code === "42501") {
      throw new Error("No se hizo: este comando necesita la conexión directa de la dueña de la base (DATABASE_URL_UNPOOLED).");
    }
    throw new Error(`No se hizo: la base respondió con ${String((error as { code?: unknown }).code ?? "un error sin código")}.`);
  } finally {
    await cliente.end();
  }
}

/** El connection string directo, como lo exige db/migrate.sh: sin -pooler ni pgbouncer. */
function urlDirecta(): string {
  const valor = process.env.DATABASE_URL_UNPOOLED ?? "";
  let analizada: URL;
  try {
    analizada = new URL(valor);
  } catch {
    throw new Error("Falta DATABASE_URL_UNPOOLED, el connection string directo de la base (el de las migraciones).");
  }
  if (!["postgres:", "postgresql:"].includes(analizada.protocol) || analizada.hostname === "") {
    throw new Error("DATABASE_URL_UNPOOLED tiene que ser el connection string directo de Postgres.");
  }
  if (analizada.hostname.includes("-pooler") || analizada.searchParams.get("pgbouncer") === "true") {
    throw new Error("DATABASE_URL_UNPOOLED apunta al connection string agrupado. Usa el directo, sin -pooler.");
  }
  return valor;
}

function informarEntrega(invitacion: InvitacionDeAlta, mostrarEnlace: boolean): void {
  const { emitida, entrega } = invitacion;
  const vence = emitida.expiraEn.toISOString();
  if (entrega.entregada) {
    console.log(`  Invitación enviada a ${emitida.correo}. Vence ${vence}.`);
    return;
  }
  console.log(`  La invitación a ${emitida.correo} quedó emitida y el correo no salió (${entrega.codigo}). Vence ${vence}.`);
  if (mostrarEnlace) {
    console.log(`  Entrega este enlace solo a esa persona: ${enlaceDeInvitacion(urlPublica(), emitida.token)}`);
  }
}

function leerOpciones(args: string[]): Record<string, string | true> {
  const opciones: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i += 1) {
    const actual = args[i] ?? "";
    if (!actual.startsWith("--")) throw new Error(`Argumento inesperado: ${actual}`);
    const nombre = actual.slice(2);
    const siguiente = args[i + 1];
    if (siguiente === undefined || siguiente.startsWith("--")) {
      opciones[nombre] = true;
    } else {
      opciones[nombre] = siguiente;
      i += 1;
    }
  }
  return opciones;
}

function exigir(opciones: Record<string, string | true>, nombre: string): string {
  const valor = opciones[nombre];
  if (typeof valor !== "string" || valor.trim().length === 0) throw new Error(`Falta --${nombre}.`);
  return valor;
}

principal(process.argv.slice(2))
  .catch((error: unknown) => {
    const texto = error instanceof ErrorDeDominio ? `No se hizo: ${error.codigo}` : error instanceof Error ? error.message : "Falló.";
    console.error(texto.replace(/postgres(ql)?:\/\/\S+/gi, "***"));
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
