import type { ArchivoPago } from "@/server/pagos-proveedores";
import { TOPE_ARCHIVO_BYTES } from "@/dominio/archivos";

/**
 * Un campo de archivo que se deja vacío llega a la acción como un File de 0
 * bytes; el navegador lo manda con filename="" y Next lo reconstruye con el
 * nombre "undefined". Un archivo sin bytes no trae documento: se trata como
 * ausente, no como un PDF vacío.
 */
function campoArchivo(valor: unknown) {
  if (typeof valor !== "object" || valor === null || !("arrayBuffer" in valor) || !("size" in valor)) return null;
  const archivo = valor as { name?: unknown; type?: unknown; size?: unknown; arrayBuffer?: () => Promise<ArrayBuffer> };
  const peso = typeof archivo.size === "number" ? archivo.size : 0;
  if (peso === 0) return null;
  return {
    nombre: typeof archivo.name === "string" ? archivo.name : "",
    tipo: typeof archivo.type === "string" ? archivo.type : "",
    peso,
    leer: typeof archivo.arrayBuffer === "function" ? archivo.arrayBuffer.bind(valor) : null,
  };
}

export async function leerArchivoAlta(valor: unknown): Promise<{
  meta: { nombre: string; tipo: string; peso: number } | null;
  bytes: Uint8Array | null;
}> {
  const archivo = campoArchivo(valor);
  if (!archivo) return { meta: null, bytes: null };
  const { nombre, tipo, peso, leer } = archivo;
  if (peso > TOPE_ARCHIVO_BYTES || !leer) return { meta: { nombre, tipo, peso }, bytes: null };
  const bytes = new Uint8Array(await leer());
  return { meta: { nombre, tipo, peso: bytes.byteLength }, bytes };
}

export async function leerArchivoPago(valor: unknown): Promise<ArchivoPago> {
  const archivo = campoArchivo(valor);
  if (!archivo) return null;
  if (archivo.peso > TOPE_ARCHIVO_BYTES || !archivo.leer) return { nombre: archivo.nombre, bytes: new Uint8Array() };
  return { nombre: archivo.nombre, bytes: new Uint8Array(await archivo.leer()) };
}
