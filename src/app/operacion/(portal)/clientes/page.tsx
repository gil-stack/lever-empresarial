import type { Metadata } from "next";
import Link from "next/link";

import { etiquetaEstado } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { registrarProspectoAccion } from "@/app/operacion/acciones";
import { exigirContextoOperacion, listarClientes } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Clientes · Operación" };

export default async function ClientesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, params] = await Promise.all([listarClientes(ctx), searchParams]);
  return (
    <PaginaOperacion titulo="Clientes" descripcion="Registra prospectos reales y sigue su activación para el portal. El alta no crea una cuenta de dinero." aviso={params.aviso}>
      <div className="operacion-rejilla">
        <section className="operacion-tarjeta">
          <h2>Registrar prospecto</h2>
          <p className="pista">Nace como prospecto, no como empresa activa.</p>
          <form action={registrarProspectoAccion} className="operacion-forma">
            <div className="campo operacion-ancho"><label htmlFor="razonSocial">Razón social</label><input id="razonSocial" name="razonSocial" maxLength={254} required /></div>
            <div className="campo"><label htmlFor="rfc">RFC</label><input className="entrada-rfc" id="rfc" name="rfc" minLength={12} maxLength={13} autoCapitalize="characters" required /></div>
            <div className="campo"><label htmlFor="codigoPostal">Código postal</label><input id="codigoPostal" name="codigoPostal" inputMode="numeric" minLength={5} maxLength={5} required /></div>
            <div className="campo"><label htmlFor="regimen">Régimen fiscal</label><select id="regimen" name="regimen" defaultValue="601" required><option value="601">601 · General de ley</option><option value="612">612 · Actividades empresariales</option><option value="620">620 · Sociedad cooperativa</option><option value="626">626 · Simplificado de confianza</option><option value="603">603 · Instituciones sin fines de lucro</option></select></div>
            <div className="campo"><label htmlFor="usoCfdi">Uso CFDI</label><select id="usoCfdi" name="usoCfdi" defaultValue="G03" required><option value="G03">G03 · Gastos en general</option><option value="S01">S01 · Sin efectos fiscales</option><option value="CP01">CP01 · Pagos</option></select></div>
            <div className="acciones"><button className="boton" type="submit">Registrar prospecto</button></div>
          </form>
        </section>
        <section className="operacion-tarjeta">
          <h2>Cartera operativa</h2>
          <p className="pista">{clientes.length} empresas de tu operador.</p>
          {clientes.length === 0 ? <p className="vacio">Todavía no hay prospectos.</p> : (
            <ul className="operacion-lista">{clientes.map((cliente) => (
              <li key={cliente.id} className="operacion-fila">
                <div className="operacion-fila-cuerpo"><h3><Link href={`/operacion/clientes/${cliente.id}`}>{cliente.razonSocial}</Link></h3><p className="operacion-meta"><span>{cliente.rfc}</span><span>{cliente.administrador ? `Administrador: ${cliente.administrador}` : "Sin administrador"}</span></p></div>
                <span className={`insignia ${cliente.estado === "activa" ? "insignia-sello" : ""}`}>{etiquetaEstado(cliente.estado)}</span>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </PaginaOperacion>
  );
}
