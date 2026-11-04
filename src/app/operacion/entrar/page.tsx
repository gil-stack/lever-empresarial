import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MarcoArco } from "@/components/entrar/marco-arco";
import { CampoContrasena } from "@/components/sistema/campo-contrasena";
import { contextoOperacion } from "@/server/operacion/contexto";

import { entrarOperacion } from "../acciones-autenticacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Operación SOFIPO" };

const AVISOS: Record<string, string> = {
  credenciales_invalidas: "El correo o la contraseña no coinciden.",
  entrada_bloqueada: "Hubo demasiados intentos. Espera quince minutos.",
  entrada_vencida: "La entrada venció. Vuelve a empezar.",
  entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
};

export default async function PaginaEntrarOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  if (await contextoOperacion()) redirect("/operacion");
  const aviso = AVISOS[(await searchParams).aviso ?? ""];
  return (
    <MarcoArco>
      <p className="arco-kicker">Personal SOFIPO</p>
      <h1>Operación de clientes.</h1>
      <p className="arco-nota">Esta puerta crea una sesión exclusiva de operación. Requiere contraseña y segundo factor.</p>
      {aviso ? <div className="alerta" role="alert"><p>{aviso}</p></div> : null}
      <form className="alta-formulario" action={entrarOperacion}>
        <div className="campo">
          <label htmlFor="correo">Correo</label>
          <input id="correo" name="correo" type="email" autoComplete="username" maxLength={254} required />
        </div>
        <div className="campo">
          <label htmlFor="contrasena">Contraseña</label>
          <CampoContrasena id="contrasena" name="contrasena" autoComplete="current-password" required />
        </div>
        <div className="acciones"><button className="boton" type="submit">Continuar</button></div>
      </form>
    </MarcoArco>
  );
}
