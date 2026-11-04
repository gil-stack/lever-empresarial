import Link from "next/link";

export function EstadoTelefono({ tipo }: { tipo: "error" | "sin_empresa" }) {
  if (tipo === "sin_empresa") {
    return (
      <><p className="kicker-app">Teléfono</p><h1>Sin empresa activa.</h1><p className="lede">Pide una invitación a quien administra la empresa.</p><p><Link className="boton-texto" href="/empresas">Ver mis empresas</Link></p></>
    );
  }
  return (
    <><p className="kicker-app">Teléfono</p><h1>No se pudieron leer los datos.</h1><p className="lede">No se muestran importes ni datos supuestos. Vuelve a intentar.</p><p><a className="boton-texto" href="">Reintentar</a></p></>
  );
}
