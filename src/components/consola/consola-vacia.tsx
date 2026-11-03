import Link from "next/link";

type SesionConocida = {
  usuarioId: string;
  empresaId: string;
} | null;

export function ConsolaVacia({ sesion }: { sesion: SesionConocida }) {
  return (
    <div className="consola">
      <p className="kicker">Consola</p>
      <h1>{sesion ? "La empresa todavía no se lee." : "Todavía no hay razón social."}</h1>
      <p className="lede">
        {sesion
          ? "La sesión existe, pero esta pantalla todavía no consulta el libro."
          : "La sesión no tiene empresa. El alta está en la puerta de entrada."}
      </p>
      {sesion ? null : (
        <Link className="boton" href="/">
          Dar de alta la razón social
        </Link>
      )}
      <section className="saldos" aria-labelledby="saldos-titulo">
        <h2 id="saldos-titulo">Dos cifras, cada una con su hora</h2>
        <dl>
          <div>
            <dt>Límite de la tarjeta</dt>
            <dd>
              <p className="frase">El emisor todavía no lo aplica.</p>
              <p className="edad">Sin hora de consulta.</p>
            </dd>
          </div>
          <div>
            <dt>Saldo de la CLABE</dt>
            <dd>
              <p className="frase">Sin consulta al participante.</p>
              <p className="edad">Sin hora de consulta.</p>
            </dd>
          </div>
        </dl>
        <p className="nota-saldos">Estas dos cifras no se suman.</p>
      </section>
    </div>
  );
}
