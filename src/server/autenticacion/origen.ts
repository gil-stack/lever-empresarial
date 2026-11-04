import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * Una passkey queda atada a un dominio y a un origen. El dominio sale del
 * encabezado de la petición y solo se acepta si está en la lista permitida.
 */

export type Origen = {
  rpID: string;
  origen: string;
};

const ANFITRION = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/;

export function origenDe(
  host: string | null | undefined,
  protocolo: string | null | undefined,
  permitidos: ReadonlySet<string>,
): Origen {
  const crudo = (host ?? "").split(",")[0]!.trim().toLowerCase();
  const partes = ANFITRION.exec(crudo);
  if (!partes) throw new ErrorDeDominio("origen_no_permitido");
  const rpID = partes[1]!;
  const puerto = partes[2];
  const local = rpID === "localhost";
  if (!permitidos.has(rpID) && !permitidos.has(crudo)) throw new ErrorDeDominio("origen_no_permitido");
  const esquema = local ? ((protocolo ?? "").split(",")[0]!.trim() === "https" ? "https" : "http") : "https";
  if (!local && puerto) throw new ErrorDeDominio("origen_no_permitido");
  return { rpID, origen: `${esquema}://${crudo}` };
}
