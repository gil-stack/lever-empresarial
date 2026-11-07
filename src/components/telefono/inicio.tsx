import Link from "next/link";

import { IconoPolitica, IconoPoliza } from "@/components/cromo/iconos";
import { enEmpresa } from "@/nucleo/rutas";
import type { InicioTelefono } from "@/server/telefono/tipos";

export function Inicio({ persona, empresa, empresaId }: { persona: InicioTelefono; empresa: string; empresaId: string }) {
  return (
    <>
      <h1 className="solo-lector">Inicio</h1>
      <p className="empresa-app">{empresa}</p>
      {persona?.bajaEn ? <p className="aviso-app">Tu baja quedó registrada para el {persona.bajaEn}.</p> : null}
      {!persona ? (
        <p className="aviso-app">Todavía no tienes ficha en Personas. Pídela a quien administra la empresa.</p>
      ) : null}
      <nav className="accesos-app" aria-label="Accesos">
        <Link href={enEmpresa(empresaId, "/telefono/topes")} className="acceso-app">
          <span className="acceso-app-icono" aria-hidden="true">
            <IconoPolitica />
          </span>
          Ver topes
        </Link>
        <Link href={enEmpresa(empresaId, "/telefono/facturacion")} className="acceso-app">
          <span className="acceso-app-icono" aria-hidden="true">
            <IconoPoliza />
          </span>
          Pedir factura
        </Link>
      </nav>
    </>
  );
}
