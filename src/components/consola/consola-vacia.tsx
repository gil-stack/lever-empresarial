import Link from "next/link";

type EmpresaVisible = {
  rfc: string;
  razonSocial: string;
} | null;

export function ConsolaVacia({
  empresa,
  libroDisponible,
  conSesion,
}: {
  empresa: EmpresaVisible;
  libroDisponible: boolean;
  conSesion: boolean;
}) {
  return (
    <div className="consola">
      <p className="kicker">Consola</p>
      <h1>{empresa ? empresa.razonSocial : "Todavía no hay razón social."}</h1>
      {empresa ? <p className="rfc-cuenta">{empresa.rfc}</p> : null}
      <p className="lede">
        {empresa
          ? "En esta cuenta no cabe otro."
          : libroDisponible
            ? "Esta cuenta todavía no tiene razón social."
            : "No se pudo consultar la cuenta."}
      </p>
      {empresa || !libroDisponible ? null : (
        <div className="acciones">
          <Link className="boton" href="/">
            Dar de alta la razón social
          </Link>
          {conSesion ? null : (
            <Link className="enlace-texto" href="/entrar">
              Entrar
            </Link>
          )}
        </div>
      )}
      <section className="saldos" aria-labelledby="saldos-titulo">
        <h2 id="saldos-titulo">Límite y saldo</h2>
        <dl>
          <div>
            <dt>Límite de la tarjeta</dt>
            <dd>
              <p className="frase">El emisor todavía no lo aplica.</p>
            </dd>
          </div>
          <div>
            <dt>Saldo de la CLABE</dt>
            <dd>
              <p className="frase">Sin consulta al participante.</p>
            </dd>
          </div>
        </dl>
        <p className="nota-saldos">Estas dos cifras no se suman.</p>
      </section>
    </div>
  );
}
