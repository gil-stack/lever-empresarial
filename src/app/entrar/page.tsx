import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FormularioEntrar } from "@/components/entrar/formulario-entrar";
import { Marco } from "@/components/cromo/marco";
import { contextoOpcional } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Entrar",
};

export default async function PaginaEntrar() {
  if (await contextoOpcional()) redirect("/consola");

  return (
    <Marco actual="/entrar">
      <main id="contenido" className="entrada">
        <p className="kicker">Entrar</p>
        <h1>Vuelve a tu cuenta.</h1>
        <p className="lede">Con el correo y la contraseña. Después, tu segundo factor.</p>
        <FormularioEntrar />
      </main>
    </Marco>
  );
}
