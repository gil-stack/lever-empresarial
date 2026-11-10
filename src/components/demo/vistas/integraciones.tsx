import { IconoCorreo } from "@/components/cromo/iconos";
import type { IntegracionesDemo } from "@/dominio/demo/integraciones";

import { Accion, Renglon, Tarjeta } from "../piezas";

/** V.integraciones del diseño: contabilidad, recursos humanos y WhatsApp. Nada se conecta. */
export function VistaIntegraciones({ datos }: { datos: IntegracionesDemo }) {
  return (
    <>
      {datos.grupos.map((grupo, i) => (
        <Tarjeta
          key={grupo.titulo}
          id={`integraciones-${i}`}
          titulo={
            <>
              {grupo.titulo}
              {grupo.premium ? <span className="demo-premium">Premium</span> : null}
            </>
          }
          nota={grupo.detalle}
        >
          <ul className="demo-integraciones">
            {grupo.sistemas.map((sistema) => (
              <li key={sistema}>
                <b>{sistema}</b>
                <small>Sin conectar</small>
                <Accion accion={{ etiqueta: "Conectar", tipo: "secundaria" }} />
              </li>
            ))}
          </ul>
        </Tarjeta>
      ))}
      <Tarjeta id="integraciones-whatsapp" titulo={datos.whatsapp.titulo} nota={datos.whatsapp.detalle}>
        <ul className="demo-lista">
          <Renglon icono={<IconoCorreo />} titulo={datos.whatsapp.estado} detalle={datos.whatsapp.nota}>
            <Accion accion={{ etiqueta: "Abrir", tipo: "fantasma" }} />
          </Renglon>
        </ul>
      </Tarjeta>
    </>
  );
}
