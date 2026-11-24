"use client";

import Link from "next/link";

import { altaRapidaAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";

import { textoDelAviso } from "./aviso";
import { EnlaceParaCopiar } from "./enlace-para-copiar";
import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-alta-rapida";

/**
 * El alta rápida de un cliente de prueba en una pantalla: razón social y su administrador (el RFC es opcional). Al
 * quedar hecho, el resultado se pinta aquí mismo: la invitación para copiar (el correo no sale en todos los entornos) y
 * si quedó dado de alta en tarjetas. El formulario se vacía para dar de alta otro.
 */
export function FormularioAltaRapida() {
  const { forma, enviar, vuelta, aviso, valor, ligado, mensaje, resumen, enlace, clienteDePrueba } = useFormularioConAviso(
    altaRapidaAccion,
    ID_AVISO,
  );
  return (
    <>
      {clienteDePrueba ? (
        <section className="prueba-resultado" aria-labelledby="prueba-resultado-titulo">
          <p id="prueba-resultado-titulo" className="prueba-resultado-titulo">
            {clienteDePrueba.razonSocial} ya está activa
          </p>
          <ul className="prueba-resultado-lista">
            <li>Quedó marcada como cliente de prueba en Operación y en su portal.</li>
            <li>
              {clienteDePrueba.tarjetas === null
                ? "Dada de alta en tarjetas, en el ambiente de pruebas. Desde su ficha le pones dinero de prueba y le asignas tarjetas."
                : `No quedó dada de alta en tarjetas: ${textoDelAviso(clienteDePrueba.tarjetas)} Inténtalo desde su ficha, en Tarjetas.`}
            </li>
            <li>
              {clienteDePrueba.entrega === "enviada"
                ? `La invitación le llegó por correo a ${clienteDePrueba.correo}.`
                : `La invitación de ${clienteDePrueba.correo} está abajo para copiarla: con ella crea su contraseña y entra al portal.`}
            </li>
          </ul>
          {enlace ? <EnlaceParaCopiar enlace={enlace} /> : null}
          <p className="operacion-enlace">
            <Link className="enlace-texto" href={`/operacion/clientes/${clienteDePrueba.id}`}>
              Abrir la ficha de {clienteDePrueba.razonSocial}
            </Link>
          </p>
        </section>
      ) : null}
      <form key={vuelta} ref={forma} action={enviar} className="formulario-pareja operacion-forma">
        {aviso && !clienteDePrueba ? <div className="operacion-ancho">{resumen}</div> : null}
        <div className="campo operacion-ancho">
          <label htmlFor="razonSocial">Nombre de la empresa de prueba</label>
          {mensaje("razonSocial")}
          <input
            id="razonSocial"
            name="razonSocial"
            maxLength={254}
            required
            autoComplete="off"
            defaultValue={valor("razonSocial")}
            {...ligado("razonSocial")}
          />
        </div>
        <div className="campo">
          <label htmlFor="nombre">Nombre del administrador</label>
          {mensaje("nombre")}
          <input id="nombre" name="nombre" maxLength={200} required autoComplete="off" defaultValue={valor("nombre")} {...ligado("nombre")} />
        </div>
        <div className="campo">
          <label htmlFor="correo">Correo del administrador</label>
          {mensaje("correo")}
          <input
            id="correo"
            name="correo"
            type="email"
            maxLength={254}
            required
            autoComplete="off"
            defaultValue={valor("correo")}
            {...ligado("correo")}
          />
        </div>
        <div className="campo operacion-ancho">
          <label htmlFor="rfc">RFC (opcional)</label>
          {mensaje("rfc")}
          <input
            className="entrada-rfc"
            id="rfc"
            name="rfc"
            maxLength={13}
            autoCapitalize="characters"
            autoComplete="off"
            aria-describedby="rfc-pista"
            defaultValue={valor("rfc")}
            {...ligado("rfc")}
          />
          <p id="rfc-pista" className="pista">
            Si lo dejas vacío, se inventa uno de prueba.
          </p>
        </div>
        <div className="acciones operacion-ancho">
          <BotonEnviar>Crear cliente de prueba</BotonEnviar>
          <p>Queda activo de inmediato, sin expediente ni aprobación.</p>
        </div>
      </form>
    </>
  );
}
