/**
 * Si un elemento se ve (para recorrer con Tab solo lo visible). `checkVisibility`
 * no existe antes de Safari 17.4 y Next compila para Safari 16.4: sin él se mira si
 * tiene caja y si su `visibility` calculada (que se hereda) no es `hidden`.
 */
export function esVisible(elemento: HTMLElement): boolean {
  if (typeof elemento.checkVisibility === "function") return elemento.checkVisibility({ visibilityProperty: true });
  return elemento.getClientRects().length > 0 && getComputedStyle(elemento).visibility !== "hidden";
}
