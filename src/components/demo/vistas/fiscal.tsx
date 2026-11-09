import Link from "next/link";

import { IconoAlerta, IconoDescargar } from "@/components/cromo/iconos";
import type { FiscalDemo } from "@/dominio/demo/fiscal";
import { enEmpresa } from "@/nucleo/rutas";

import { Accion, Cifras, pesos, Tarjeta } from "../piezas";

export type EnlacesFiscales = { lista69b: boolean; poliza: boolean };

/**
 * Fiscal reúne lo que ya existe (la Lista 69-B y la Póliza, módulos reales) con
 * lo que falta (IVA, alertas y DIOT). Los enlaces reales se ven igual en una
 * empresa real y en una de demostración.
 */
export function EnlacesFiscal({ empresaId, enlaces }: { empresaId: string | null; enlaces: EnlacesFiscales }) {
  if (!enlaces.lista69b && !enlaces.poliza) return null;
  return (
    <div className="demo-barra-herramientas">
      <nav className="segmentado" aria-label="Fiscal">
        <Link href={enEmpresa(empresaId, "/consola/fiscal")} aria-current="page">
          Resumen fiscal
        </Link>
        {enlaces.lista69b ? <Link href={enEmpresa(empresaId, "/consola/lista-69b")}>Lista 69-B</Link> : null}
        {enlaces.poliza ? <Link href={enEmpresa(empresaId, "/consola/poliza")}>Póliza contable</Link> : null}
      </nav>
    </div>
  );
}

/** plat-06: IVA acreditable, alertas fiscales y la DIOT del mes. */
export function VistaFiscal({ datos, empresaId }: { datos: FiscalDemo; empresaId: string | null }) {
  return (
    <>
      <Cifras cifras={datos.cifras} etiqueta="Fiscal de octubre" />
      <div className="demo-rejilla demo-g2">
        <Tarjeta id="fiscal-alertas" titulo="Alertas fiscales" nota="Lever revisa cada factura y cada pago">
          <ul className="demo-revision">
            {datos.alertas.map((alerta) => (
              <li key={alerta.titulo}>
                <span className="demo-revision-punto" data-tono={alerta.grave ? "peligro" : "aviso"} aria-hidden="true">
                  <IconoAlerta />
                </span>
                <div>
                  <b data-tono={alerta.grave ? "peligro" : undefined}>{alerta.titulo}</b>
                  <small>{alerta.detalle}</small>
                  <Link
                    className="demo-enlace"
                    href={enEmpresa(empresaId, alerta.enlace === "Ir a Proveedores" ? "/consola/proveedores" : "/consola/movimientos")}
                  >
                    {alerta.enlace}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta
          id="fiscal-diot"
          titulo={
            <>
              DIOT de octubre <span className="demo-premium">Premium</span>
            </>
          }
          acciones={<Accion accion={{ etiqueta: "Descargar", tipo: "secundaria" }} icono={<IconoDescargar />} />}
        >
          <p className="demo-tenue demo-antes-de-tabla">IVA pagado a cada proveedor, armado con las facturas que ya están en Lever. Tu contador la revisa y la presenta.</p>
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de la DIOT de octubre">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Proveedor</th>
                  <th scope="col" className="derecha">
                    Pagado sin IVA
                  </th>
                  <th scope="col" className="derecha">
                    IVA
                  </th>
                </tr>
              </thead>
              <tbody>
                {datos.diot.map((renglon) => (
                  <tr key={renglon.rfc}>
                    <td>
                      <b>{renglon.proveedor}</b>
                      <small className="demo-mono">{renglon.rfc}</small>
                    </td>
                    <td className="derecha">{pesos(renglon.sinIvaCentavos)}</td>
                    <td className="derecha">{pesos(renglon.ivaCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="demo-tenue">y 11 proveedores más en la descarga</p>
        </Tarjeta>
      </div>
    </>
  );
}
