import Link from "next/link";

import { CabezaPagina } from "@/components/sistema";

export function MaestroCerrado({
  aviso,
}: {
  aviso: "libro" | "entrar" | "sin_empresa" | "no_abre" | "ausente";
}) {
  if (aviso === "ausente") {
    return (
      <CabezaPagina kicker="Personas" titulo="No encontramos este registro.">
        <p className="lede">No pertenece a esta empresa o ya no está disponible.</p>
        <div className="acciones"><Link className="boton" href="/consola/personas">Volver a Personas</Link></div>
      </CabezaPagina>
    );
  }
  if (aviso === "entrar") {
    return (
      <CabezaPagina kicker="Personas" titulo="Entra para ver Personas.">
        <p className="lede">Personas se abre con la sesión de tu empresa.</p>
        <div className="acciones"><Link className="boton" href="/entrar">Entrar</Link></div>
      </CabezaPagina>
    );
  }
  if (aviso === "sin_empresa") {
    return (
      <CabezaPagina kicker="Personas" titulo="Elige una empresa.">
        <p className="lede">Personas se abre dentro de una empresa.</p>
        <div className="acciones"><Link className="boton" href="/empresas">Elegir empresa</Link></div>
      </CabezaPagina>
    );
  }
  if (aviso === "no_abre") {
    return (
      <CabezaPagina kicker="Personas" titulo="Tu rol no abre esta pantalla.">
        <p className="lede">Pide acceso a quien administra la empresa.</p>
      </CabezaPagina>
    );
  }
  return (
    <CabezaPagina kicker="Personas" titulo="No se pudo abrir Personas.">
      <p className="lede">Vuelve a intentarlo en un momento.</p>
    </CabezaPagina>
  );
}
