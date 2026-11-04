import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { puertasDe } from "@/components/cromo/puertas";
import { PantallaProveedores } from "@/components/proveedores/pantalla";
import { CabezaPagina } from "@/components/sistema";
import { puedeVerProveedores } from "@/dominio/proveedores";
import { errorConSecreto, leerEntrada, sesionDesdeCookie } from "@/server/entrada";
import { leerClabesProveedor, leerProveedores } from "@/server/proveedores";
import { ErrorDeDominio, type Rol } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Proveedores",
};

type Carga =
  | { tipo: "sin_sesion" }
  | { tipo: "sin_empresa"; nombre: string; rol: Rol | null }
  | { tipo: "cerrado"; nombre: string | null; rol: Rol | null; aviso: "rol" | "libro" }
  | {
      tipo: "lista";
      nombre: string;
      rol: Rol;
      lectura: Awaited<ReturnType<typeof leerProveedores>>;
      historial: Awaited<ReturnType<typeof leerClabesProveedor>>;
    };

export default async function PaginaProveedores() {
  const carga = await cargar();
  const persona = carga.tipo === "sin_sesion" ? null : carga.nombre ? { nombre: carga.nombre } : null;
  const conEmpresa = carga.tipo === "lista" || (carga.tipo !== "sin_sesion" && carga.rol !== null && carga.tipo !== "sin_empresa");

  return (
    <Marco
      actual="/consola/proveedores"
      persona={persona}
      {...puertasDe(carga.tipo === "sin_sesion" ? null : carga.rol, conEmpresa)}
    >
      <main id="contenido" className="pagina pagina-proveedores">
        {carga.tipo === "lista" ? (
          <PantallaProveedores
            rol={carga.rol}
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
      {carga.tipo === "sin_sesion" ? (
        <div className="acciones">
          <Link className="boton" href="/entrar">
            Entrar
          </Link>
        </div>
      ) : null}
      {carga.tipo === "sin_empresa" ? (
        <div className="acciones">
          <Link className="boton" href="/alta">
            Dar de alta la empresa
          </Link>
        </div>
      ) : null}
    </CabezaPagina>
  );
}

function relatoCerrado(carga: Exclude<Carga, { tipo: "lista" }>): { titulo: string; detalle: string } {
  if (carga.tipo === "sin_sesion") {
    return {
      titulo: "Entra para dar de alta un proveedor.",
      detalle: "La constancia y la CLABE se quedan en la consola de finanzas.",
    };
  }
  if (carga.tipo === "sin_empresa") {
    return {
      titulo: "Primero, la razón social.",
      detalle: "El proveedor pertenece a una empresa. Esta cuenta todavía no tiene RFC.",
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

async function cargar(): Promise<Carga> {
  const entrada = await leerEntrada();
  if (!entrada.libroDisponible) return { tipo: "cerrado", nombre: entrada.nombre, rol: entrada.rol, aviso: "libro" };
  if (!entrada.nombre) return { tipo: "sin_sesion" };
  if (!entrada.rfc) return { tipo: "sin_empresa", nombre: entrada.nombre, rol: entrada.rol };
  if (!puedeVerProveedores(entrada.rol)) {
    return { tipo: "cerrado", nombre: entrada.nombre, rol: entrada.rol, aviso: "rol" };
  }
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "sin_sesion" };
    const lectura = await leerProveedores(sesion);
    const historial = await leerClabesProveedor(sesion);
    if (!sesion.rol) return { tipo: "cerrado", nombre: entrada.nombre, rol: entrada.rol, aviso: "rol" };
    return { tipo: "lista", nombre: entrada.nombre, rol: sesion.rol, lectura, historial };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      if (error.codigo === "proveedores_no_disponibles" || error.codigo === "clabe_no_disponible") {
        return { tipo: "cerrado", nombre: entrada.nombre, rol: entrada.rol, aviso: "rol" };
      }
      if (error.codigo === "sin_empresa") return { tipo: "sin_empresa", nombre: entrada.nombre, rol: entrada.rol };
      if (error.codigo === "sesion_ausente") return { tipo: "sin_sesion" };
      return { tipo: "cerrado", nombre: entrada.nombre, rol: entrada.rol, aviso: "libro" };
    }
    if (errorConSecreto(error)) return { tipo: "cerrado", nombre: entrada.nombre, rol: entrada.rol, aviso: "libro" };
    throw error;
  }
}
