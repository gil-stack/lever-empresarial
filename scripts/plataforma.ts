/**
 * Comando del personal del operador, hasta que la fase 5 abra su portal.
 *
 *   npx tsx scripts/plataforma.ts personal:migrar-variable
 *   npx tsx scripts/plataforma.ts empresa:alta --personal <correo> --rfc <RFC> --razon <texto>
 *       --cp <12345> --regimen <601> --uso <G03> --admin-nombre <texto> --admin-correo <correo>
 *       [--demostracion] [--mostrar-enlace]
 *   npx tsx scripts/plataforma.ts suscripcion:aceptar --personal <correo> --empresa <uuid>
 *
 * Lee DATABASE_URL y no la imprime. Cada acto queda en la bitácora con el
 * personal que lo hizo y el origen «comando». El enlace de una invitación es
 * de un solo uso y es de la persona invitada: solo se imprime con
 * --mostrar-enlace, cuando el correo no salió.
 */
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
  throw new Error("Orden desconocida. Usa personal:migrar-variable, empresa:alta o suscripcion:aceptar.");
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
