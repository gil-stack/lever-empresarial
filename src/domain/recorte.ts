/**
 * Regímenes que la puerta dice que no entran y que, por eso, no se guardan.
 * 623 es grupo de sociedades. 610 es residente en el extranjero.
 * 605 es sueldos: la empresa que paga nómina factura con 601 o 626, y el
 * asalariado cuya empresa no adopta no abre cuenta. CN01 es el uso de nómina
 * de ese régimen.
 */

export const REGIMENES_FUERA_DE_CUENTA = ["605", "610", "623"] as const;

export const USOS_FUERA_DE_CUENTA = ["CN01"] as const;

export function regimenFueraDeCuenta(codigo: string): boolean {
  return (REGIMENES_FUERA_DE_CUENTA as readonly string[]).includes(codigo);
}

export function usoFueraDeCuenta(codigo: string): boolean {
  return (USOS_FUERA_DE_CUENTA as readonly string[]).includes(codigo);
}
