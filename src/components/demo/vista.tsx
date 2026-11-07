import type { ProductoDemo } from "@/dominio/demo/productos";
import type { CargaDemo } from "@/server/demo/regla";

import { ID_AVISO_DEMO } from "./piezas";
import { VistaConciliacion } from "./vistas/conciliacion";
import { VistaCredito } from "./vistas/credito";
import { VistaCuenta } from "./vistas/cuenta";
import { VistaFiscal } from "./vistas/fiscal";
import { VistaGastos } from "./vistas/gastos";
import { VistaIntegraciones } from "./vistas/integraciones";
import { VistaInternacional } from "./vistas/internacional";
import { VistaInversion } from "./vistas/inversion";
import { VistaMovimientos } from "./vistas/movimientos";
import { VistaAhorro, VistaGasolina, VistaViajes } from "./vistas/ocasionales";
import { VistaTarjetas } from "./vistas/tarjetas";

/**
 * Lo que ve una empresa real en un módulo que todavía no existe: el nombre y
 * una línea de producto. Ni una cifra, ni un nombre de ejemplo.
 */
export function DisponiblePronto({ producto }: { producto: ProductoDemo }) {
  return (
    <section className="demo-pronto" aria-labelledby="demo-pronto-titulo">
      <p className="eyebrow">Disponible pronto</p>
      <h2 id="demo-pronto-titulo">{producto.titulo}</h2>
      <p>{producto.producto}</p>
    </section>
  );
}

/** La línea de arriba de cada módulo de demostración: lo que se ve es de ejemplo y nada mueve dinero. */
export function AvisoDemostracion() {
  return (
    <p className="demo-aviso" id={ID_AVISO_DEMO}>
      <strong>Demostración.</strong>
      <span>Datos de ejemplo de Altamar Logística. Los botones que moverían dinero o crearían algo están apagados.</span>
    </p>
  );
}

/** Cada módulo con sus datos de ejemplo, o «Disponible pronto» si la empresa es real. */
export function VistaDemo({
  carga,
  empresaId,
  params = {},
}: {
  carga: CargaDemoCualquiera;
  empresaId: string | null;
  params?: Record<string, string | undefined>;
}) {
  if (carga.tipo === "pronto") return <DisponiblePronto producto={carga.producto} />;
  return (
    <>
      <AvisoDemostracion />
      {contenido(carga, empresaId, params)}
    </>
  );
}

export type CargaDemoCualquiera =
  | CargaDemo<"conciliacion">
  | CargaDemo<"gastos">
  | CargaDemo<"tarjetas">
  | CargaDemo<"movimientos">
  | CargaDemo<"fiscal">
  | CargaDemo<"cuenta">
  | CargaDemo<"internacional">
  | CargaDemo<"credito">
  | CargaDemo<"inversion">
  | CargaDemo<"viajes">
  | CargaDemo<"gasolina">
  | CargaDemo<"ahorro">
  | CargaDemo<"integraciones">;

function contenido(carga: Extract<CargaDemoCualquiera, { tipo: "demostracion" }>, empresaId: string | null, params: Record<string, string | undefined>) {
  switch (carga.modulo) {
    case "conciliacion":
      return <VistaConciliacion datos={carga.datos} />;
    case "gastos":
      return <VistaGastos datos={carga.datos} empresaId={empresaId} />;
    case "tarjetas":
      return <VistaTarjetas datos={carga.datos} empresaId={empresaId} vista={params.vista === "presupuestos" ? "presupuestos" : "tarjetas"} />;
    case "movimientos":
      return <VistaMovimientos datos={carga.datos} empresaId={empresaId} params={params} />;
    case "fiscal":
      return <VistaFiscal datos={carga.datos} empresaId={empresaId} />;
    case "cuenta":
      return <VistaCuenta datos={carga.datos} />;
    case "internacional":
      return <VistaInternacional datos={carga.datos} />;
    case "credito":
      return <VistaCredito datos={carga.datos} />;
    case "inversion":
      return <VistaInversion datos={carga.datos} />;
    case "viajes":
      return <VistaViajes datos={carga.datos} />;
    case "gasolina":
      return <VistaGasolina datos={carga.datos} />;
    case "ahorro":
      return <VistaAhorro datos={carga.datos} />;
    case "integraciones":
      return <VistaIntegraciones datos={carga.datos} />;
  }
}
