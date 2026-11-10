import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { FormularioAviso } from "@/components/operacion/pld/formularios-de-texto";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { EtiquetaMono, Hoja, NotaRegla, Vacio } from "@/components/sistema";
import { TIPO_AVISO } from "@/dominio/pld";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { empresasParaPld, misAcuses, personalParaExcluir } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Avisar a Cumplimiento · Operación" };

/**
 * 54ª fr. VIII y 60ª, último párrafo: cualquier persona del personal avisa a
 * Cumplimiento de forma confidencial. Quien avisa ve solo su acuse; la persona
 * mencionada y el superior que marque no ven el aviso, aunque tengan Cumplimiento.
 */
export default async function AvisosOperacion({ searchParams }: { searchParams: Parametros<"aviso" | "en"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  if (!puedeEnOperacion(ctx, "plataforma.pld.aviso.emitir")) {
    return (
      <PaginaOperacion titulo="Avisar a Cumplimiento">
        <SinPermiso>Este aviso lo envía el personal activo de la SOFIPO.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const [acuses, personas, clientes] = await Promise.all([
    misAcuses(ctx),
    personalParaExcluir(ctx),
    puedeEnOperacion(ctx, "plataforma.operacion.ver") ? empresasParaPld(ctx) : Promise.resolve([]),
  ]);

  return (
    <PaginaOperacion titulo="Avisar a Cumplimiento" aviso={params.aviso}>
      <Hoja id="aviso-titulo" titulo="Nuevo aviso">
        <p>
          Si viste algo que podría ser una operación inusual de un cliente, o una conducta preocupante de alguien de la SOFIPO, avísale a
          Cumplimiento. Solo Cumplimiento y Auditoría lo leen; tú ves tu acuse con su folio.
        </p>
        <FormularioAviso
          formId={randomUUID()}
          clientes={clientes.map((cliente) => ({ id: cliente.id, razonSocial: cliente.razonSocial }))}
          personas={personas.map((persona) => ({ id: persona.id, nombre: persona.nombre }))}
        />
      </Hoja>

      <Hoja id="acuses-titulo" titulo="Tus acuses">
        {acuses.length === 0 ? (
          <Vacio titulo="Sin avisos enviados">Cuando envíes un aviso, aquí queda tu acuse con su folio.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {acuses.map((acuse) => (
              <li key={acuse.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>{TIPO_AVISO[acuse.tipo]}</h3>
                    <p className="operacion-meta">
                      <span>Recibido {fechaHora(acuse.recibidoEn)}</span>
                    </p>
                  </div>
                  <EtiquetaMono nombre="Folio">{acuse.folio}</EtiquetaMono>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Hoja>

      <NotaRegla>
        Lever no avisa a la empresa ni a las personas marcadas. El texto del aviso no aparece en la bitácora; ahí solo queda que hubo un aviso.
      </NotaRegla>
    </PaginaOperacion>
  );
}
