import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { cargarListaAccion } from "@/app/operacion/acciones-alta";
import { errorDelCampo, LISTA_DEMASIADO_GRANDE } from "@/components/operacion/aviso";
import { CampoArchivo } from "@/components/operacion/campo-archivo";
import { Coincidencias } from "@/components/operacion/coincidencias";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, Hoja, Insignia, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, listarCargas, listarCoincidencias, puedeEnOperacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Personas bloqueadas · Operación" };

type Busqueda = { aviso?: string; en?: string; linea?: string; filas?: string; coincidencias?: string };

/**
 * La Lista de Personas Bloqueadas (74ª y 75ª). Cumplimiento sube la lista completa que le
 * notifica la UIF en el formato documentado; cada carga se guarda aparte y no se borra. La base
 * coteja al confirmar la carga, al dar de alta y antes de liberar un pago o preparar una nómina.
 */
export default async function ListaBloqueadas({ searchParams }: { searchParams: Parametros<keyof Busqueda> }) {
  const ctx = await exigirContextoOperacion();
  if (!puedeEnOperacion(ctx, "plataforma.cumplimiento.bandeja")) {
    return (
      <PaginaOperacion titulo="Personas bloqueadas">
        <SinPermiso>La Lista de Personas Bloqueadas la llevan Cumplimiento y la consulta Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const ahora = new Date();
  const [cargas, coincidencias, params] = await Promise.all([listarCargas(ctx), listarCoincidencias(ctx), soloTexto(searchParams)]);
  const carga = puedeEnOperacion(ctx, "plataforma.lpb.cargar");
  const resuelve = puedeEnOperacion(ctx, "plataforma.lpb.resolver");
  const detalle =
    params.aviso === "lpb_renglon_invalido" && /^\d{1,6}$/.test(params.linea ?? "")
      ? `Revisa la línea ${params.linea} del archivo: nombre obligatorio, RFC de 12 o 13 caracteres, CURP de 18, tipo «fisica» o «moral» y fecha AAAA-MM-DD.`
      : params.aviso === "lpb_cargada" && /^\d+$/.test(params.filas ?? "") && /^\d+$/.test(params.coincidencias ?? "")
        ? `${params.filas} ${params.filas === "1" ? "renglón" : "renglones"}; ${params.coincidencias} ${params.coincidencias === "1" ? "coincidencia nueva" : "coincidencias nuevas"}.`
        : undefined;
  return (
    <PaginaOperacion titulo="Personas bloqueadas" aviso={params.aviso} detalleAviso={detalle}>
      <Rejilla
        principal={
          <Hoja id="coincidencias-titulo" titulo="Coincidencias">
            <Coincidencias
              coincidencias={coincidencias}
              resuelve={resuelve}
              desde="lpb"
              ahora={ahora}
              aviso={params.aviso}
              en={params.en}
              vacio="Al cargar la lista, la base coteja empresas, representantes, accionistas, propietarios reales y proveedores."
            />
          </Hoja>
        }
        lateral={
          <>
            {carga ? (
              <Hoja id="cargar-titulo" titulo="Cargar la lista vigente">
                <p className="pista">
                  Un CSV en UTF-8 con este encabezado exacto: <code>nombre,rfc,curp,tipo,fecha</code>. El tipo es «fisica» o «moral»; RFC,
                  CURP y fecha pueden ir vacíos.
                </p>
                <form action={cargarListaAccion}>
                  <input type="hidden" name="formId" value={randomUUID()} />
                  <div className="campo">
                    <label htmlFor="archivo">Archivo CSV</label>
                    <CampoArchivo
                      id="archivo"
                      name="archivo"
                      accept=".csv,text/csv"
                      mensaje={LISTA_DEMASIADO_GRANDE}
                      required
                      ligado={errorDelCampo(params.aviso, "archivo")}
                    />
                  </div>
                  <div className="acciones">
                    <BotonEnviar>Cargar y cotejar</BotonEnviar>
                  </div>
                </form>
              </Hoja>
            ) : null}
            <Hoja id="cargas-titulo" titulo="Cargas">
              {cargas.length === 0 ? (
                <Vacio titulo="Todavía no hay lista">Sin una lista cargada solo se cotejan los EFOS definitivos de la 69-B.</Vacio>
              ) : (
                <ul className="operacion-lista">
                  {cargas.map((registro) => (
                    <li key={registro.id}>
                      <div className="operacion-fila">
                        <div className="operacion-fila-cuerpo">
                          <h3>{registro.nombreArchivo}</h3>
                          <p className="operacion-meta">
                            <span>{registro.filas} renglones</span>
                            <span>{registro.coincidencias} coincidencias</span>
                            <span>
                              {registro.cargadaPor} · {fechaHora(registro.cargadaEn)}
                            </span>
                          </p>
                        </div>
                        <Insignia tono={registro.vigente ? "sello" : "neutro"}>{registro.vigente ? "Vigente" : "Anterior"}</Insignia>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Hoja>
          </>
        }
      />
      <NotaRegla>
        Un RFC o una CURP idénticos son coincidencia; un nombre parecido es posible coincidencia y siempre lo revisa una persona.
        Si coincide la empresa, un representante o un propietario real, la empresa queda suspendida de inmediato. Lever no transmite
        reportes a la UIF.
      </NotaRegla>
    </PaginaOperacion>
  );
}
