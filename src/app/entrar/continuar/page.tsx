import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Continuar } from "@/components/entrar/continuar";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { destinoSeguro, leerPaso, NOMBRE_COOKIE_ENTRADA, prepararTotp, rutaDeDestino, type AltaTotp } from "@/server/autenticacion";
import { leerTokenEntrada, NOMBRE_COOKIE_PORTAL } from "@/server/autenticacion/cookie";
import { leerEntrada } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Segundo factor",
};

export default async function PaginaContinuar({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string }>;
}) {
  const destino = destinoSeguro((await searchParams).siguiente);
  const entrada = await leerEntrada();
  if (entrada.nombre) redirect(rutaDeDestino(destino));

  const jar = await cookies();
  const portal = leerTokenEntrada(jar.get(NOMBRE_COOKIE_PORTAL)?.value);
  if (portal) {
    return (
      <MarcoArco>
        <Continuar
          paso={{ paso: "inscribir", nombre: "", correo: "", porRecuperacion: false }}
          siguiente={destino}
          alta={null}
          sinTotp
          yaInscrito
        />
      </MarcoArco>
    );
  }

  const token = leerTokenEntrada(jar.get(NOMBRE_COOKIE_ENTRADA)?.value);
  let paso;
  try {
    paso = await leerPaso(token);
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "entrada_vencida") {
      redirect(`/entrar?aviso=entrada_vencida&siguiente=${encodeURIComponent(destino)}`);
    }
    throw error;
  }

  let alta: AltaTotp | null = null;
  let sinTotp = false;
  if (paso.paso === "inscribir") {
    try {
      alta = await prepararTotp(token);
    } catch (error) {
      if (error instanceof ErrorDeDominio && (error.codigo === "totp_no_disponible" || error.codigo === "qr_no_disponible")) {
        sinTotp = true;
      } else {
        throw error;
      }
    }
  }

  return (
    <MarcoArco>
      <Continuar paso={paso} siguiente={destino} alta={alta} sinTotp={sinTotp} />
    </MarcoArco>
  );
}
