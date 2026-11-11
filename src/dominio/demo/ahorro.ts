import { congelar, type AccionDemo } from "./tipos";

export type OportunidadDemo = { readonly titulo: string; readonly detalle: string; readonly accion: AccionDemo };

export type AhorroDemo = {
  readonly total: string;
  readonly resumen: string;
  readonly oportunidades: readonly OportunidadDemo[];
  readonly nota: string;
};

export const AHORRO_DEMO: AhorroDemo = congelar({
  total: "$1,709",
  resumen: "2 oportunidades encontradas en los gastos de octubre",
  oportunidades: [
    { titulo: "Google Workspace · ahorra $521 al mes", detalle: "Pagas 14 licencias y 9 personas usan su correo de la empresa (dato de ejemplo). Quitar 5 licencias ahorra cada mes.", accion: { etiqueta: "Revisar después", tipo: "fantasma" } },
    { titulo: "Office Depot · ahorra $1,188 al mes", detalle: "La papelería del mes se compró en tienda. Con un proveedor por volumen se paga cerca de 12% menos (estimado).", accion: { etiqueta: "Entendido", tipo: "fantasma" } },
  ],
  nota: "Lever compara tus suscripciones, comercios y precios contra tus propios gastos. Las cifras marcadas «estimado» o «dato de ejemplo» son del prototipo.",
});
