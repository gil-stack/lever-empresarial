import { ErrorDeDominio } from "../session/error-de-dominio";

/**
 * Archivo privado de la constancia. La clave que vuelve es una ruta, no una URL.
 * Si el almacén no está, el alta no se guarda: no queda un proveedor sin PDF.
 */

export type AlmacenConstancia = {
  guardar(entrada: { clave: string; bytes: Uint8Array; tipo: string }): Promise<{ clave: string }>;
  borrar(clave: string): Promise<void>;
};

type BlobPut = (
  path: string,
  body: Buffer,
  opciones: {
    access: "private";
    token: string;
    contentType: string;
    addRandomSuffix: boolean;
  },
) => Promise<{ pathname?: string; url?: string }>;

type BlobDel = (path: string, opciones: { token: string }) => Promise<void>;

export function almacenVercel(): AlmacenConstancia {
  return {
    async guardar(entrada) {
      const token = leerToken();
      try {
        const modulo = (await import("@vercel/blob")) as unknown as { put?: BlobPut };
        if (!modulo.put) throw new ErrorDeDominio("archivo_no_disponible");
        const resultado = await modulo.put(entrada.clave, Buffer.from(entrada.bytes), {
          access: "private",
          token,
          contentType: entrada.tipo,
          addRandomSuffix: false,
        });
        const clave = resultado.pathname;
        if (typeof clave !== "string" || clave.length === 0 || /^https?:\/\//i.test(clave) || /blob\.vercel/i.test(clave)) {
          throw new ErrorDeDominio("archivo_no_disponible");
        }
        return { clave };
      } catch (error) {
        if (error instanceof ErrorDeDominio) throw error;
        throw new ErrorDeDominio("archivo_no_disponible");
      }
    },
    async borrar(clave) {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (typeof token !== "string" || token.length === 0) return;
      try {
        const modulo = (await import("@vercel/blob")) as unknown as { del?: BlobDel };
        if (!modulo.del) return;
        await modulo.del(clave, { token });
      } catch {
        // El PDF huérfano no se anuncia. El alta ya no está en el libro.
      }
    },
  };
}

function leerToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (typeof token !== "string" || token.length === 0) throw new ErrorDeDominio("archivo_no_disponible");
  return token;
}
