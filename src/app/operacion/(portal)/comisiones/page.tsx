import type { Metadata } from "next";
import Link from "next/link";

import { solicitarComisionAccion } from "@/app/operacion/acciones";
import { etiquetaEstado, fechaDia } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { textoComision } from "@/dominio/operacion";
import { exigirContextoOperacion, listarClientes, listarComisiones } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Comisiones · Operación" };

export default async function ComisionesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, versiones, params] = await Promise.all([listarClientes(ctx), listarComisiones(ctx), searchParams]);
  const activos = clientes.filter((cliente) => cliente.estado === "activa");
  return (
    <PaginaOperacion titulo="Comisiones por empresa" descripcion="Fondeo se guarda en basis points enteros; SPEI en centavos MXN enteros. Las versiones no generan cargos, devengos ni facturas." aviso={params.aviso}>
      <div className="operacion-rejilla">
        <section className="operacion-tarjeta">
          <h2>Proponer una versión</h2>
          <p className="pista">Otra persona deberá autorizarla. Solo empresas activas para el portal.</p>
          {activos.length === 0 ? <p className="vacio">Activa un cliente antes de configurar comisiones.</p> : (
            <form action={solicitarComisionAccion} className="operacion-forma">
              <div className="campo operacion-ancho"><label htmlFor="companyId">Empresa</label><select id="companyId" name="companyId" required>{activos.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.razonSocial} · {cliente.rfc}</option>)}</select></div>
              <div className="campo"><label htmlFor="tipo">Tipo</label><select id="tipo" name="tipo"><option value="fondeo">Fondeo · basis points</option><option value="spei">SPEI · centavos MXN</option></select></div>
              <div className="campo"><label htmlFor="valor">Valor entero</label><input id="valor" name="valor" inputMode="numeric" pattern="[0-9]+" maxLength={16} required /><p className="pista">Ejemplo: 250 bp = 2.50 %; 1500 centavos = $15.00.</p></div>
              <div className="campo"><label htmlFor="vigenteDesde">Vigente desde</label><input id="vigenteDesde" name="vigenteDesde" type="date" required /></div>
              <div className="acciones"><button className="boton" type="submit">Solicitar autorización</button></div>
            </form>
          )}
        </section>
        <section className="operacion-tarjeta">
          <h2>Historial de versiones</h2>
          <p className="pista">Las vigencias autorizadas no se solapan; al sustituir una versión queda su cierre.</p>
          {versiones.length === 0 ? <p className="vacio">No hay versiones configuradas.</p> : <ul className="operacion-lista">{versiones.map((version) => <li key={version.id}>
            <div className="operacion-fila"><div className="operacion-fila-cuerpo"><h3><Link href={`/operacion/clientes/${version.companyId}`}>{version.razonSocial}</Link> · {version.tipo}</h3><p className="operacion-detalle">{textoComision(version.tipo, version.valor)}</p><p className="operacion-meta">Desde {fechaDia(version.vigenteDesde)}{version.vigenteHasta ? ` hasta ${fechaDia(version.vigenteHasta)}` : ""} · propuso {version.solicitante}</p></div><span className={`insignia ${version.estado === "vigente" ? "insignia-sello" : ""}`}>{etiquetaEstado(version.estado)}</span></div>
          </li>)}</ul>}
        </section>
      </div>
    </PaginaOperacion>
  );
}
