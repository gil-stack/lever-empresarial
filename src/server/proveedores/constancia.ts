import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * Archivo privado de la constancia. La clave que vuelve es una ruta, no una URL.
 * Si el almacén no está, el alta no se guarda: no queda un proveedor sin PDF.
 */

export type AlmacenConstancia = {
  guardar(entrada: { clave: string; bytes: Uint8Array; tipo: string }): Promise<{ clave: string }>;
  borrar(clave: string): Promise<void>;
};

type CredencialesBlob = { token?: string; oidcToken?: string; storeId?: string };

type BlobPut = (
  path: string,
  body: Buffer,
  opciones: CredencialesBlob & {
    access: "private";
    contentType: string;
    addRandomSuffix: boolean;
  },
) => Promise<{ pathname?: string; url?: string }>;

type BlobDel = (path: string, opciones: CredencialesBlob) => Promise<void>;
type BlobGet = (
  path: string,
  opciones: CredencialesBlob & { access: "private"; useCache: boolean },
) => Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;

export function almacenVercel(): AlmacenConstancia {
  return {
    async guardar(entrada) {
      const credenciales = credencialesBlob();
      try {
        const modulo = (await import("@vercel/blob")) as unknown as { put?: BlobPut };
        if (!modulo.put) throw new ErrorDeDominio("archivo_no_disponible");
        const resultado = await modulo.put(entrada.clave, Buffer.from(entrada.bytes), {
          access: "private",
          ...credenciales,
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
      const credenciales = credencialesBlobOpcional();
      if (!credenciales) return;
      try {
        const modulo = (await import("@vercel/blob")) as unknown as { del?: BlobDel };
        if (!modulo.del) return;
        await modulo.del(clave, credenciales);
      } catch {
        // El PDF huérfano no se anuncia. El alta ya no está en el libro.
      }
    },
  };
}

/** Lee por clave interna. Nunca acepta una URL ni expone el almacén al navegador. */
export async function leerPrivado(clave: string): Promise<ReadableStream<Uint8Array>> {
  if (!clave || /^https?:\/\//i.test(clave) || /blob\.vercel/i.test(clave)) throw new ErrorDeDominio("archivo_no_disponible");
  try {
    const modulo = (await import("@vercel/blob")) as unknown as { get?: BlobGet };
    if (!modulo.get) throw new ErrorDeDominio("archivo_no_disponible");
    const resultado = await modulo.get(clave, { access: "private", ...credencialesBlob(), useCache: false });
    if (!resultado || resultado.statusCode !== 200 || !resultado.stream) throw new ErrorDeDominio("archivo_no_disponible");
    return resultado.stream;
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("archivo_no_disponible");
  }
}

function credencialesBlob(): CredencialesBlob {
  const credenciales = credencialesBlobOpcional();
  if (!credenciales) throw new ErrorDeDominio("archivo_no_disponible");
  return credenciales;
}

function credencialesBlobOpcional(): CredencialesBlob | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (typeof token === "string" && token.length > 0) return { token };
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  if (typeof oidcToken === "string" && oidcToken.length > 0 && typeof storeId === "string" && storeId.length > 0) {
    return { oidcToken, storeId };
  }
  return null;
}
