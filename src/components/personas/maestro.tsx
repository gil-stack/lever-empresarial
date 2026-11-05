import Link from "next/link";

import { clabeVisible } from "@/dominio/clabe";
import {
  estaDeBaja,
  fechaLarga,
  FRASE_CONTADOR,
  FRASE_SIN_DISPERSION,
  lineaDeRoles,
  relatoOperabilidad,
  type RolCuenta,
} from "@/dominio/personas";
import { capacidadesDe, tiene } from "@/nucleo/capacidades";
import type { LecturaMaestro } from "@/server/personas/tipos";

import { FormularioBaja, FormularioCentro, FormularioFinanzas, FormularioPersona } from "./formularios";

export function Maestro({
  lectura,
  hoy,
  roles,
  edita,
}: {
  lectura: LecturaMaestro;
  hoy: string;
  /** Roles de quien mira, en esta empresa. Solo cambian el texto de entrada. */
  roles: readonly RolCuenta[];
  /** Lo decide la matriz de capacidades con el contexto. */
  edita: boolean;
}) {
  const relato = relatoOperabilidad(lectura.autorizados);
  const jefes = lectura.personas
    .filter((persona) => !estaDeBaja(persona.bajaEn, hoy))
    .map((persona) => ({ id: persona.id, nombre: persona.nombre }));

  return (
    <>
      <p className="kicker">Maestro</p>
      <h1>Personas</h1>
      <p className="lede">
        Aquí se anota el jefe, el centro de costo, la fecha de baja y la CLABE. No sale dinero.
      </p>
      <section className="ficha" aria-labelledby="firmas-titulo">
        <h2 id="firmas-titulo">{relato.titulo}</h2>
        <p className="lede">{relato.detalle}</p>
        <dl>
          <div>
            <dt>Personas autorizadas</dt>
            <dd>{lectura.autorizados.length === 0 ? "Ninguna" : lectura.autorizados.join(", ")}</dd>
          </div>
          <div>
            <dt>Dispersión</dt>
            <dd>{FRASE_SIN_DISPERSION}</dd>
          </div>
          <div>
            <dt>Contador</dt>
            <dd>{FRASE_CONTADOR}</dd>
          </div>
        </dl>
      </section>
      <p className="regla-fija">{entradaDe(roles, edita)}</p>

      <section className="bloque" aria-labelledby="centros-titulo">
        <h2 id="centros-titulo">Centros de costo</h2>
        {lectura.centros.length === 0 ? (
          <p className="lede">Todavía no hay un centro de costo. Nómbralo antes de dar de alta a una persona.</p>
        ) : (
          <ul className="nombres">
            {lectura.centros.map((centro) => (
              <li key={centro.id}>{centro.nombre}</li>
            ))}
          </ul>
        )}
        {edita ? <FormularioCentro /> : null}
      </section>

      <section className="personas" aria-labelledby="lista-titulo">
        <h2 id="lista-titulo">En el maestro</h2>
        {lectura.personas.length === 0 ? (
          <p className="lede">Todavía no hay personas. El alta de abajo es la primera.</p>
        ) : (
          lectura.personas.map((persona) => {
            const deBaja = estaDeBaja(persona.bajaEn, hoy);
            return (
              <article key={persona.id} className="persona" aria-labelledby={`persona-${persona.id}`}>
                <div className="persona-cabeza">
                  <h3 id={`persona-${persona.id}`}>{persona.nombre}</h3>
                  <p className={deBaja ? "estado-persona estado-baja" : "estado-persona"}>
                    {deBaja ? "De baja" : persona.bajaEn ? "Baja programada" : "Vigente"}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Jefe</dt>
                    <dd>{persona.jefeNombre ?? "Sin jefe"}</dd>
                  </div>
                  <div>
                    <dt>Centro de costo</dt>
                    <dd>{persona.centroNombre}</dd>
                  </div>
                  <div>
                    <dt>Alta</dt>
                    <dd>{fechaLarga(persona.altaEn)}</dd>
                  </div>
                  <div>
                    <dt>Baja</dt>
                    <dd>{persona.bajaEn ? fechaLarga(persona.bajaEn) : "Sin fecha"}</dd>
                  </div>
                  <div>
                    <dt>CLABE</dt>
                    <dd className="clabe">{clabeVisible(persona.clabe)}</dd>
                  </div>
                  <div>
                    <dt>En la consola</dt>
                    <dd>
                      {deBaja ? "De baja. No suelta dinero." : lineaDeRoles(persona.roles, persona.invitada)}
                      {persona.correo ? <span className="pista"> {persona.correo}</span> : null}
                    </dd>
                  </div>
                </dl>
                {edita && persona.userId && tiene(capacidadesDe({ rolesCliente: persona.roles, rolesPlataforma: [] }), "cliente.consola.ver") ? (
                  persona.roles.includes("administrador") ? (
                    <p className="pista">Inicio financiero está incluido con administración.</p>
                  ) : (
                    <FormularioFinanzas
                      key={persona.userId}
                      userId={persona.userId}
                      habilitado={persona.roles.includes("finanzas")}
                    />
                  )
                ) : null}
                {edita ? (
                  <FormularioBaja personaId={persona.id} nombre={persona.nombre} bajaActual={persona.bajaEn} />
                ) : null}
              </article>
            );
          })
        )}
        {edita ? (
          <FormularioPersona hoy={hoy} centros={lectura.centros} jefes={jefes} />
        ) : (
          <p className="regla-fija">Este rol ve el maestro. No da de alta ni registra la baja.</p>
        )}
      </section>
    </>
  );
}

function entradaDe(roles: readonly RolCuenta[], edita: boolean): string {
  if (edita) return "Das de alta a las personas. Esta pantalla no suelta dinero.";
  if (roles.includes("liberador")) return "Entraste como liberador. Esta pantalla no suelta dinero.";
  return "Entraste como contador. Ves el maestro y no sueltas dinero.";
}

export function MaestroCerrado({
  aviso,
}: {
  aviso: "libro" | "entrar" | "sin_empresa" | "no_abre";
}) {
  if (aviso === "entrar") {
    return (
      <>
        <p className="kicker">Maestro</p>
        <h1>Hay que entrar.</h1>
        <p className="lede">El maestro se abre con la sesión de la empresa.</p>
        <div className="acciones">
          <Link className="boton" href="/entrar">
            Entrar
          </Link>
        </div>
      </>
    );
  }
  if (aviso === "sin_empresa") {
    return (
      <>
        <p className="kicker">Maestro</p>
        <h1>Todavía no hay razón social.</h1>
        <p className="lede">La SOFIPO da de alta a las empresas. Luego, sus personas.</p>
      </>
    );
  }
  if (aviso === "no_abre") {
    return (
      <>
        <p className="kicker">Maestro</p>
        <h1>Este rol no abre el maestro.</h1>
        <p className="lede">
          La CLABE de las personas la ve quien administra, quien libera y el contador. Este rol no.
        </p>
      </>
    );
  }
  return (
    <>
      <p className="kicker">Maestro</p>
      <h1>No se pudo consultar el maestro.</h1>
      <p className="lede">Vuelve a intentar en un momento.</p>
    </>
  );
}
