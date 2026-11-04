import QRCode from "qrcode";

import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { DatosFiscalesTelefono } from "./tipos";

/** Datos de lectura para compartir; no representa un comprobante ni acredita una operación. */
export function contenidoDeDatosFiscales(datos: DatosFiscalesTelefono): string {
  return JSON.stringify({
    tipo: "ARCO_DATOS_FISCALES",
    version: 1,
    rfc: datos.rfc,
    razonSocial: datos.razonSocial,
    codigoPostal: datos.codigoPostal,
    regimen: datos.regimen,
    uso: datos.uso,
  });
}

export async function qrDeDatosFiscales(datos: DatosFiscalesTelefono): Promise<string> {
  try {
    return await QRCode.toDataURL(contenidoDeDatosFiscales(datos), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
    });
  } catch {
    throw new ErrorDeDominio("qr_no_disponible");
  }
}
