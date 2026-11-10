/**
 * Comando del personal del operador para la cobranza con Fintoc.
 *
 *   npx tsx scripts/cobranza-fintoc.ts cuenta:registrar --personal <correo> --empresa <uuid> --cuenta <acc_…>
 *
 * Registra la cuenta de la empresa en Fintoc (el Account de su Entity), una
 * vez que Fintoc aprobó su KYB. Desde ahí, cada cliente de la empresa recibe su
 * CLABE propia. Nunca en una empresa de demostración. Lee DATABASE_URL y no la
 * imprime; no recibe ni imprime llaves. Queda en la bitácora con el personal y
 * el origen «comando».
 */
import { cerrarConexion } from "../src/nucleo/db";
import { ErrorDeDominio } from "../src/nucleo/error-de-dominio";
import { registrarCuentaFintoc } from "../src/server/cobranza/fintoc";
import { contextoDePersonal } from "../src/server/plataforma/servicio";

async function principal(argv: string[]): Promise<void> {
  const [orden, ...resto] = argv;
  const opciones = leerOpciones(resto);
  if (orden === "cuenta:registrar") {
    const ctx = await contextoDePersonal(exigir(opciones, "personal"));
    await registrarCuentaFintoc(ctx, { empresaId: exigir(opciones, "empresa"), cuentaId: exigir(opciones, "cuenta") });
    console.log("La cuenta de Fintoc quedó registrada. La tarea diaria pide las CLABEs de los clientes que falten.");
    return;
  }
  throw new Error("Orden desconocida. Usa cuenta:registrar.");
}

function leerOpciones(args: string[]): Record<string, string> {
  const opciones: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const nombre = args[i] ?? "";
    const valor = args[i + 1];
    if (!nombre.startsWith("--") || valor === undefined || valor.startsWith("--")) throw new Error(`Argumento inesperado: ${nombre}`);
    opciones[nombre.slice(2)] = valor;
  }
  return opciones;
}

function exigir(opciones: Record<string, string>, nombre: string): string {
  const valor = opciones[nombre];
  if (!valor || valor.trim().length === 0) throw new Error(`Falta --${nombre}.`);
  return valor.trim();
}

principal(process.argv.slice(2))
  .catch((error: unknown) => {
    const texto = error instanceof ErrorDeDominio ? `No se hizo: ${error.codigo}` : error instanceof Error ? error.message : "Falló.";
    console.error(texto.replace(/postgres(ql)?:\/\/\S+/gi, "***"));
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
