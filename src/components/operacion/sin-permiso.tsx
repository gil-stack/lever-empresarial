import type { ReactNode } from "react";

import { Hoja, Vacio } from "@/components/sistema";

/**
 * El estado «sin permiso» de Operación: la sección existe, pero el rol de la persona no la abre.
 * Dice quién sí puede, para que sepa a quién pedírselo. El servidor rechaza igual la acción.
 */
export function SinPermiso({ children }: { children: ReactNode }) {
  return (
    <Hoja id="sin-permiso-titulo" titulo="Sin permiso">
      <Vacio titulo="Tu rol no abre esta sección">{children}</Vacio>
    </Hoja>
  );
}
