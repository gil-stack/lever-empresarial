import { redirect } from "next/navigation";

export const runtime = "nodejs";

/**
 * Las recuperaciones de segundo factor se resuelven en Operación, con sesión
 * SOFIPO y confirmación reciente. Esta dirección vieja solo lleva allá.
 */
export default function PaginaRecuperaciones(): never {
  redirect("/operacion/recuperaciones");
}
