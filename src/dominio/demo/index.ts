import { AHORRO_DEMO, type AhorroDemo } from "./ahorro";
import { CONCILIACION_DEMO, type ConciliacionDemo } from "./conciliacion";
import { CREDITO_DEMO, type CreditoDemo } from "./credito";
import { CUENTA_DEMO, type CuentaDemo } from "./cuenta";
import { FISCAL_DEMO, type FiscalDemo } from "./fiscal";
import { GASOLINA_DEMO, type GasolinaDemo } from "./gasolina";
import { GASTOS_DEMO, type GastosDemo } from "./gastos";
import { INTEGRACIONES_DEMO, type IntegracionesDemo } from "./integraciones";
import { INTERNACIONAL_DEMO, type InternacionalDemo } from "./internacional";
import { INVERSION_DEMO, type InversionDemo } from "./inversion";
import { MOVIMIENTOS_DEMO, type MovimientosDemo } from "./movimientos";
import type { ModuloDemo } from "./productos";
import { TARJETAS_DEMO, type TarjetasDemo } from "./tarjetas";
import { congelar } from "./tipos";
import { VIAJES_DEMO, type ViajesDemo } from "./viajes";

/** Los datos de ejemplo de cada módulo demo, tipados por módulo. */
export type DatosDemo = {
  conciliacion: ConciliacionDemo;
  gastos: GastosDemo;
  tarjetas: TarjetasDemo;
  movimientos: MovimientosDemo;
  fiscal: FiscalDemo;
  cuenta: CuentaDemo;
  internacional: InternacionalDemo;
  credito: CreditoDemo;
  inversion: InversionDemo;
  viajes: ViajesDemo;
  gasolina: GasolinaDemo;
  ahorro: AhorroDemo;
  integraciones: IntegracionesDemo;
};

export const DATOS_DEMO: Readonly<{ [M in ModuloDemo]: DatosDemo[M] }> = congelar({
  conciliacion: CONCILIACION_DEMO,
  gastos: GASTOS_DEMO,
  tarjetas: TARJETAS_DEMO,
  movimientos: MOVIMIENTOS_DEMO,
  fiscal: FISCAL_DEMO,
  cuenta: CUENTA_DEMO,
  internacional: INTERNACIONAL_DEMO,
  credito: CREDITO_DEMO,
  inversion: INVERSION_DEMO,
  viajes: VIAJES_DEMO,
  gasolina: GASOLINA_DEMO,
  ahorro: AHORRO_DEMO,
  integraciones: INTEGRACIONES_DEMO,
});
