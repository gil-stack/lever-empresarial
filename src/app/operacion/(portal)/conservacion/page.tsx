import type { Metadata } from "next";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { errorDelCampo, MensajeDelCampo } from "@/components/operacion/aviso";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { Hoja, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { hoyEnMexico } from "@/dominio/operacion/comisiones";
import { exigirContextoOperacion, puedeEnOperacion } from "@/server/operacion";
import { ahoraPld, DOCUMENTOS_POR_PAGINA, empresasParaPld } from "@/server/pld";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Conservación · Operación" };

/**
 * 61ª: conservar al menos 10 años. Las operaciones, el expediente y lo de PLD no
 * se borran (la base lo impide). Aquí Cumplimiento y Auditoría descargan un
 * manifiesto verificable por empresa y periodo; cada descarga queda en la bitácora.
 */
export default async function ConservacionOperacion({ searchParams }: { searchParams: Parametros<"aviso" | "en" | "companyId" | "desde" | "hasta" | "pagina" | "despuesEn" | "despuesId"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  if (!puedeEnOperacion(ctx, "plataforma.pld.manifiesto")) {
    return (
      <PaginaOperacion titulo="Conservación">
        <SinPermiso>El manifiesto de conservación lo descargan Cumplimiento y Auditoría.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const clientes = puedeEnOperacion(ctx, "plataforma.operacion.ver") ? await empresasParaPld(ctx) : [];
  const hoy = hoyEnMexico(ahoraPld());
  const haceUnAnio = `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`;
  const error = (campo: string) => (params.en === "manifiesto-titulo" ? errorDelCampo(params.aviso, campo) : {});
  const mensaje = (campo: string) => (params.en === "manifiesto-titulo" ? <MensajeDelCampo codigo={params.aviso} campo={campo} /> : null);

  return (
    <PaginaOperacion titulo="Conservación" aviso={params.aviso}>
      <Hoja id="manifiesto-titulo" titulo="Manifiesto de conservación">
        <p>
          Un archivo con el conteo de registros de cada tabla de la empresa en el periodo y, por cada documento, su huella SHA-256, su ruta y su tamaño. Sirve
          para verificar después que nada se perdió ni cambió.
        </p>
        {clientes.length === 0 ? (
          <Vacio titulo="Sin empresas">Cuando haya empresas dadas de alta, aquí se elige de cuál sacar el manifiesto.</Vacio>
        ) : (
          <form method="get" action="/operacion/conservacion/manifiesto" className="formulario-pareja operacion-forma">
            <div className="campo operacion-ancho">
              <label htmlFor="manifiesto-empresa">Empresa</label>
              {mensaje("companyId")}
              <select id="manifiesto-empresa" name="companyId" required defaultValue={clientes.some((cliente) => cliente.id === params.companyId) ? params.companyId : ""} {...error("companyId")}>
                <option value="" disabled>
                  Elige una
                </option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.razonSocial} · {cliente.rfc}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="manifiesto-desde">Desde</label>
              {mensaje("periodo")}
              <input id="manifiesto-desde" name="desde" type="date" required defaultValue={params.desde ?? haceUnAnio} max={hoy} {...error("periodo")} />
            </div>
            <div className="campo">
              <label htmlFor="manifiesto-hasta">Hasta</label>
              <input id="manifiesto-hasta" name="hasta" type="date" required defaultValue={params.hasta ?? hoy} max={hoy} {...error("periodo")} />
            </div>
            <details className="operacion-detalle operacion-ancho" open={Boolean(params.despuesEn || params.despuesId || (params.pagina && params.pagina !== "1"))}>
              <summary>Continuar un manifiesto de varias páginas</summary>
              <p className="pista">
                Cada página trae hasta {DOCUMENTOS_POR_PAGINA.toLocaleString("es-MX")} documentos. Si la última línea del archivo dice «siguiente», copia aquí
                sus valores.
              </p>
              <div className="formulario-pareja">
                <div className="campo">
                  <label htmlFor="manifiesto-pagina">Página</label>
                  {mensaje("pagina")}
                  <input id="manifiesto-pagina" name="pagina" inputMode="numeric" defaultValue={params.pagina ?? "1"} {...error("pagina")} />
                </div>
                <div className="campo">
                  <label htmlFor="manifiesto-despues-en">Después de (fecha y hora)</label>
                  {mensaje("despuesEn")}
                  <input id="manifiesto-despues-en" name="despuesEn" autoComplete="off" defaultValue={params.despuesEn ?? ""} {...error("despuesEn")} />
                </div>
                <div className="campo">
                  <label htmlFor="manifiesto-despues-id">Después del documento</label>
                  {mensaje("despuesId")}
                  <input id="manifiesto-despues-id" name="despuesId" autoComplete="off" className="operacion-mono" defaultValue={params.despuesId ?? ""} {...error("despuesId")} />
                </div>
              </div>
            </details>
            <div className="acciones operacion-ancho">
              <button className="boton" type="submit">
                Descargar manifiesto
              </button>
              <p>La descarga queda en la bitácora con tu nombre, la empresa y el periodo.</p>
            </div>
          </form>
        )}
      </Hoja>

      <Hoja id="cubre-titulo" titulo="Qué se conserva">
        <Renglones>
          <Renglon etiqueta="Pagos a proveedores y su historial">No se borran ni se truncan.</Renglon>
          <Renglon etiqueta="Lotes de nómina y sus renglones">No se borran ni se truncan.</Renglon>
          <Renglon etiqueta="Movimientos y cobros esperados">No se borran ni se truncan.</Renglon>
          <Renglon etiqueta="Expediente">Las versiones enviadas, sus documentos y las calificaciones no se editan ni se borran.</Renglon>
          <Renglon etiqueta="Alertas, casos, dictámenes y reportes de PLD">Solo se agregan; no se editan ni se borran.</Renglon>
        </Renglones>
      </Hoja>

      <NotaRegla>
        El destino de la copia periódica de 10 años, fuera de la base y del almacén de archivos, está pendiente de definir con el Oficial de Cumplimiento.
      </NotaRegla>
    </PaginaOperacion>
  );
}
