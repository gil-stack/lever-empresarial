import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Emulador del almacén privado de Vercel Blob para los recorridos de navegador.
 *
 * Solo existe en pruebas: lo levanta tests/e2e/entorno.ts, escucha en 127.0.0.1
 * y guarda en memoria. La aplicación no cambia. `@vercel/blob` manda put() y
 * del() a VERCEL_BLOB_API_URL (variable que la propia librería soporta), y
 * get() pide https://<almacén>.private.blob.vercel-storage.com/<ruta>; el
 * --import de ./preload.mjs desvía solo ese host a GET /almacen/<ruta>.
 *
 * Como el almacén real es privado, la lectura exige el mismo token con el que
 * se escribió. Un token que no es el del emulador recibe 403.
 *
 * `POST /simular` con `{ "borrado": "503" | "sin_respuesta" | "normal" }` simula un Blob caído solo para
 * del(): put() y get() siguen funcionando, como cuando falla el borrado de un huérfano.
 */

export type BlobLocal = {
  /** Origen del emulador, sin barra final. */
  origen: string;
  /** Valor para VERCEL_BLOB_API_URL. */
  api: string;
  /** Rutas guardadas, para que una prueba revise qué subió la aplicación. */
  rutas(): string[];
  cerrar(): Promise<void>;
};

type Archivo = { bytes: Buffer; tipo: string };

export async function iniciarBlobLocal(puerto: number, token: string): Promise<BlobLocal> {
  const archivos = new Map<string, Archivo>();
  let borrado: "normal" | "503" | "sin_respuesta" = "normal";
  const autorizado = (req: IncomingMessage) => req.headers.authorization === `Bearer ${token}`;

  const servidor: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const responder = (estado: number, cuerpo: unknown) => {
      res.statusCode = estado;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(cuerpo));
    };
    const error = (estado: number, code: string, message: string) => responder(estado, { error: { code, message } });

    if (url.pathname === "/salud") return responder(200, { ok: true });
    if (!autorizado(req)) return error(403, "forbidden", "Token de Blob distinto al del emulador.");

    if (req.method === "PUT" && url.pathname.replace(/\/$/, "") === "/api/blob") {
      const pathname = url.searchParams.get("pathname");
      if (!pathname) return error(400, "bad_request", "Falta pathname.");
      const reemplazar = req.headers["x-allow-overwrite"] === "1";
      if (archivos.has(pathname) && !reemplazar) return error(400, "bad_request", "This blob already exists.");
      const bytes = await leer(req);
      const tipo = String(req.headers["x-content-type"] ?? "application/octet-stream");
      archivos.set(pathname, { bytes, tipo });
      const publica = `${origen()}/almacen/${pathname}`;
      return responder(200, {
        url: publica,
        downloadUrl: `${publica}?download=1`,
        pathname,
        contentType: tipo,
        contentDisposition: "attachment",
        etag: `"${bytes.length}"`,
      });
    }

    if (req.method === "POST" && url.pathname === "/simular") {
      const pedido = JSON.parse((await leer(req)).toString() || "{}") as { borrado?: string };
      if (pedido.borrado !== "normal" && pedido.borrado !== "503" && pedido.borrado !== "sin_respuesta") return error(400, "bad_request", "Modo de borrado desconocido.");
      borrado = pedido.borrado;
      return responder(200, { borrado });
    }

    if (req.method === "POST" && url.pathname === "/api/blob/delete") {
      if (borrado === "503") return error(503, "service_unavailable", "Blob caído (simulado).");
      if (borrado === "sin_respuesta") return;
      const { urls } = JSON.parse((await leer(req)).toString() || "{}") as { urls?: string[] };
      for (const entrada of urls ?? []) {
        archivos.delete(/^https?:\/\//.test(entrada) ? decodeURIComponent(new URL(entrada).pathname.slice(1)) : entrada);
      }
      return responder(200, {});
    }

    if (req.method === "GET" && url.pathname.startsWith("/almacen/")) {
      const pathname = decodeURIComponent(url.pathname.slice("/almacen/".length));
      const archivo = archivos.get(pathname);
      if (!archivo) return error(404, "not_found", "No existe.");
      res.statusCode = 200;
      res.setHeader("content-type", archivo.tipo);
      res.setHeader("content-length", String(archivo.bytes.length));
      res.end(archivo.bytes);
      return;
    }

    return error(400, "bad_request", `Ruta no emulada: ${req.method} ${url.pathname}`);
  });

  await new Promise<void>((listo, fallo) => {
    servidor.once("error", fallo);
    servidor.listen(puerto, "127.0.0.1", () => listo());
  });
  const origen = () => `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  return {
    origen: origen(),
    api: `${origen()}/api/blob`,
    rutas: () => [...archivos.keys()],
    cerrar: () => new Promise((listo) => servidor.close(() => listo())),
  };
}

function leer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((listo, fallo) => {
    const partes: Buffer[] = [];
    req.on("data", (parte: Buffer) => partes.push(parte));
    req.on("end", () => listo(Buffer.concat(partes)));
    req.on("error", fallo);
  });
}
