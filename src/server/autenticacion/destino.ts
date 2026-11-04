import { capacidadesDe, tiene, type RolCliente } from "../../nucleo/capacidades";
import { enEmpresa } from "../../nucleo/rutas";

/** Solo superficies conocidas; nunca se acepta una URL como destino. */
const DESTINOS = new Set(["/consola", "/telefono"]);

export type EmpresaParaDestino = {
  id: string;
  razonSocial: string;
  roles: readonly RolCliente[];
};

export function destinoSeguro(valor: unknown): "/consola" | "/telefono" {
  return typeof valor === "string" && DESTINOS.has(valor) ? (valor as "/consola" | "/telefono") : "/consola";
}

/** Tras el segundo factor, la membresía decide la superficie; el navegador solo expresa preferencia. */
export function destinoDespuesDeEntrar(
  empresas: readonly EmpresaParaDestino[],
  siguiente: unknown,
): string {
  if (empresas.length !== 1) return "/empresas";
  const empresa = empresas[0];
  if (!empresa) return "/empresas";
  return destinoDeMembresia(empresa, destinoSeguro(siguiente)) ?? "/empresas";
}

/** Un rol combinado conserva ambas puertas; el tarjetahabiente puro solo abre el teléfono. */
export function destinoDeMembresia(
  empresa: EmpresaParaDestino,
  preferida: "/consola" | "/telefono" = "/consola",
): string | null {
  const capacidades = capacidadesDe({ rolesCliente: empresa.roles, rolesPlataforma: [] });
  const consola = tiene(capacidades, "cliente.consola.ver");
  const telefono = tiene(capacidades, "telefono.inicio.ver");
  if (preferida === "/telefono" && telefono) return enEmpresa(empresa.id, "/telefono");
  if (consola) return enEmpresa(empresa.id, "/consola");
  if (telefono) return enEmpresa(empresa.id, "/telefono");
  return null;
}

export function rutaDeDestino(siguiente: unknown): string {
  return `/entrar/destino?siguiente=${encodeURIComponent(destinoSeguro(siguiente))}`;
}
