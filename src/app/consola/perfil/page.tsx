import type { Metadata } from "next";
import Link from "next/link";

import "@/estilo/aprobaciones.css";

import { IconoApariencia, IconoSeguridad } from "@/components/cromo/iconos";
import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { Aviso, Hoja, Renglon, Renglones } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Mi perfil" };

/**
 * Lo mínimo de la persona: quién es en esta empresa y a dónde ir para su
 * seguridad (contraseña, llave de acceso, app autenticadora) y su apariencia.
 * No edita nada aquí: cada cambio vive en su página, con sus propias reglas.
 */
export default async function PaginaPerfil() {
  const apertura = await abrirRuta("/consola/perfil");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const vista = vistaDeMarco(ctx);
  return (
    <Marco actual="/consola/perfil" vista={vista}>
      <main id="contenido" className="pagina perfil">
        <h1 className="solo-lector">Mi perfil</h1>
        {!ctx ? (
          <div className="aprobaciones-estado">
            <Aviso titulo="No se pudo consultar tu perfil">
              <p>Vuelve a intentarlo en un momento.</p>
            </Aviso>
            <Link className="boton" href="/consola/perfil">
              Reintentar
            </Link>
          </div>
        ) : (
          <>
            <Hoja id="perfil-datos" titulo="Tus datos">
              <Renglones>
                <Renglon etiqueta="Nombre">{ctx.persona.nombre}</Renglon>
                <Renglon etiqueta="Correo">{ctx.persona.correo}</Renglon>
                {ctx.empresa ? <Renglon etiqueta="Empresa">{ctx.empresa.razonSocial}</Renglon> : null}
                {vista.persona?.rol ? <Renglon etiqueta="Tu rol aquí">{vista.persona.rol}</Renglon> : null}
              </Renglones>
              <p className="aprobaciones-tenue perfil-nota">
                Tu rol en esta empresa lo asigna quien la administra.
              </p>
            </Hoja>
            <section className="hoja aprobaciones-tarjeta" aria-labelledby="perfil-ajustes">
              <header className="aprobaciones-cabeza">
                <h2 id="perfil-ajustes">Tu cuenta</h2>
                <small>Solo cambia para ti</small>
              </header>
              <ul className="aprobaciones-renglones">
                <li>
                  <span className="decision-icono" aria-hidden="true">
                    <IconoSeguridad />
                  </span>
                  <div>
                    <h3>Seguridad</h3>
                    <p>Contraseña, llaves de acceso, app autenticadora y códigos de respaldo.</p>
                  </div>
                  <Link className="boton-texto boton-chico" href="/entrar/seguridad">
                    Abrir seguridad
                  </Link>
                </li>
                <li>
                  <span className="decision-icono" aria-hidden="true">
                    <IconoApariencia />
                  </span>
                  <div>
                    <h3>Apariencia</h3>
                    <p>Tema, fondo, tono y movimiento de la consola.</p>
                  </div>
                  <Link className="boton-texto boton-chico" href={enEmpresa(ctx.empresa?.id, "/consola/apariencia")}>
                    Abrir apariencia
                  </Link>
                </li>
              </ul>
            </section>
          </>
        )}
      </main>
    </Marco>
  );
}
