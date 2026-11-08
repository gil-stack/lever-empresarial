import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { emitirAvisoAccion } from "@/app/operacion/(portal)/pld/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, EtiquetaMono, Hoja, NotaRegla, Vacio } from "@/components/sistema";
import { TIPO_AVISO, TIPOS_AVISO } from "@/dominio/pld";
import { exigirContextoOperacion, listarClientes, puedeEnOperacion } from "@/server/operacion";
import { misAcuses, personalParaExcluir } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Avisar a Cumplimiento · Operación" };

/**
 * 54ª fr. VIII y 60ª, último párrafo: cualquier persona del personal avisa a
 * Cumplimiento de forma confidencial. Quien avisa ve solo su acuse; la persona
 * mencionada y el superior que marque no ven el aviso, aunque tengan Cumplimiento.
 */
export default async function AvisosOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string; en?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const params = await searchParams;
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
    puedeEnOperacion(ctx, "plataforma.operacion.ver") ? listarClientes(ctx) : Promise.resolve([]),
  ]);
  const error = (campo: string) => (params.en === "aviso-titulo" ? errorDelCampo(params.aviso, campo) : {});

  return (
    <PaginaOperacion titulo="Avisar a Cumplimiento" aviso={params.aviso}>
      <Hoja id="aviso-titulo" titulo="Nuevo aviso">
        <p>
          Si viste algo que podría ser una operación inusual de un cliente, o una conducta preocupante de alguien de la SOFIPO, avísale a
          Cumplimiento. Solo Cumplimiento y Auditoría lo leen; tú ves tu acuse con su folio.
        </p>
        <form action={emitirAvisoAccion} className="formulario-pareja operacion-forma">
          <input type="hidden" name="formId" value={randomUUID()} />
          <div className="campo">
            <label htmlFor="aviso-tipo">De qué se trata</label>
            <select id="aviso-tipo" name="tipo" required defaultValue="" {...error("tipo")}>
              <option value="" disabled>
                Elige uno
              </option>
              {TIPOS_AVISO.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {TIPO_AVISO[tipo]}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="aviso-empresa">Empresa (si aplica)</label>
            <select id="aviso-empresa" name="companyId" defaultValue="" {...error("companyId")}>
              <option value="">Ninguna en particular</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.razonSocial}
                </option>
              ))}
            </select>
          </div>
          <div className="campo operacion-ancho">
            <label htmlFor="aviso-descripcion">Qué viste, cuándo y quién estuvo involucrado</label>
            <textarea id="aviso-descripcion" name="descripcion" required minLength={20} maxLength={4000} {...error("descripcion")} />
          </div>
          <div className="campo">
            <label htmlFor="aviso-mencionada">Persona del personal mencionada (si aplica)</label>
            <select id="aviso-mencionada" name="mencionada" defaultValue="" {...error("mencionada")}>
              <option value="">Nadie del personal</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="aviso-superior">Tu superior jerárquico (si no debe enterarse)</label>
            <select id="aviso-superior" name="superior" defaultValue="" {...error("superior")}>
              <option value="">No marcar a nadie</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="acciones operacion-ancho">
            <BotonEnviar>Enviar aviso</BotonEnviar>
            <p>Las personas que marques no podrán ver este aviso, aunque tengan el rol de Cumplimiento.</p>
          </div>
        </form>
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
