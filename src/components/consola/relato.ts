/** La consola sin empresa: el libro no respondió, o la persona todavía no tiene una empresa activa. */
export function relatoSinEmpresa(libroDisponible: boolean): { titulo: string; detalle: string } {
  if (!libroDisponible) {
    return {
      titulo: "Todavía no hay razón social.",
      detalle: "No se pudo consultar la cuenta.",
    };
  }
  return {
    titulo: "Todavía no hay razón social.",
    detalle: "Tu cuenta no tiene una empresa activa. La SOFIPO da de alta a las empresas y te invita.",
  };
}
