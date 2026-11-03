import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FormularioEntrar } from "@/components/entrar/formulario-entrar";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { leerEntrada } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Entrar",
};

export default async function PaginaEntrar() {
  const entrada = await leerEntrada();
  if (entrada.nombre) redirect("/consola");

  return (
    <>
      <Encabezado actual="/entrar" />
      <main id="contenido" className="entrada">
        <p className="kicker">Entrar</p>
        <h1>Vuelve a tu cuenta.</h1>
        <p className="lede">Con el correo y la contraseña. No hace falta llenar otra vez el alta.</p>
        <FormularioEntrar />
      </main>
      <Pie />
    </>
  );
}
