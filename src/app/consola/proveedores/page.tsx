import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { PantallaProveedores } from "@/components/proveedores/pantalla";
import { CabezaPagina } from "@/components/sistema";
import { puede, type ContextoDeTenant } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerClabesProveedor, leerProveedores } from "@/server/proveedores";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Proveedores",
};

type Carga =
  | { tipo: "sin_empresa" }
  | { tipo: "cerrado"; aviso: "rol" | "libro" }
  | {
      tipo: "lista";
      edita: boolean;
      lectura: Awaited<ReturnType<typeof leerProveedores>>;
      historial: Awaited<ReturnType<typeof leerClabesProveedor>>;
    };

export default async function PaginaProveedores() {
  const apertura = await abrirRuta("/consola/proveedores");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga =
    apertura.tipo === "libro"
      ? ({ tipo: "cerrado", aviso: "libro" } as const)
      : apertura.tipo === "sin_permiso"
        ? ({ tipo: "cerrado", aviso: "rol" } as const)
        : apertura.tipo === "sin_empresa" || !ctx
          ? ({ tipo: "sin_empresa" } as const)
          : await cargar(ctx);

  return (
    <Marco actual="/consola/proveedores" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina pagina-proveedores">
        {carga.tipo === "lista" ? (
          <PantallaProveedores
            edita={carga.edita}
            lista={carga.lectura.lista}
            proveedores={carga.lectura.proveedores}
            historial={carga.historial}
          />
        ) : (
          <Cerrada carga={carga} />
        )}
      </main>
    </Marco>
  );
}

function Cerrada({ carga }: { carga: Exclude<Carga, { tipo: "lista" }> }) {
  const relato = relatoCerrado(carga);
  return (
    <CabezaPagina kicker="Proveedores" titulo={relato.titulo}>
      <p className="lede">{relato.detalle}</p>
      {carga.tipo === "sin_empresa" ? (
        <div className="acciones">
          <Link className="boton" href="/entrar">
            Entrar
          </Link>
        </div>
      ) : null}
    </CabezaPagina>
  );
}

function relatoCerrado(carga: Exclude<Carga, { tipo: "lista" }>): { titulo: string; detalle: string } {
  if (carga.tipo === "sin_empresa") {
    return {
      titulo: "Primero, la razón social.",
      detalle: "El proveedor pertenece a una empresa. La SOFIPO da de alta a las empresas.",
    };
  }
  if (carga.aviso === "rol") {
    return {
      titulo: "Esta sección no abre con tu rol.",
      detalle: "El alta de proveedores es de la consola de finanzas. El teléfono del tarjetahabiente no la lleva.",
    };
  }
  return {
    titulo: "El libro no está disponible.",
    detalle: "No se mostró un proveedor ni una constancia.",
  };
}

async function cargar(ctx: ContextoDeTenant): Promise<Carga> {
  try {
    const lectura = await leerProveedores(ctx);
    const historial = await leerClabesProveedor(ctx);
    return { tipo: "lista", edita: puede(ctx, "cliente.proveedores.alta"), lectura, historial };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      if (error.codigo === "proveedores_no_disponibles" || error.codigo === "clabe_no_disponible") {
        return { tipo: "cerrado", aviso: "rol" };
      }
      if (error.codigo === "sin_empresa") return { tipo: "sin_empresa" };
      return { tipo: "cerrado", aviso: "libro" };
    }
    if (errorConSecreto(error)) return { tipo: "cerrado", aviso: "libro" };
    throw error;
  }
}
