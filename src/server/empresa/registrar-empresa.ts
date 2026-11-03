import "server-only";

import { validarAlta, type AltaEmpresa, type EstadoAlta } from "@/dominio/alta";

/**
 * Hueco de la fase 1. La forma ya se valida aquí, en el servidor.
 * Falta escribir `companies`, abrir la sesión y registrar la auditoría.
 * Un segundo RFC no cabe en la misma cuenta: esa regla se aplica al
 * persistir, no en el navegador. No hay SQL en esta entrega.
 */
export function registrarEmpresa(entrada: AltaEmpresa): EstadoAlta {
  const { alta, errores } = validarAlta(entrada);
  if (errores.length > 0) return { tipo: "invalido", errores };
  return dejarPendienteDeLibro(alta);
}

function dejarPendienteDeLibro(altaNormalizada: AltaEmpresa): EstadoAlta {
  void altaNormalizada;
  return { tipo: "pendiente_de_libro" };
}
