/**
 * Sin sesión, la consola no habla de «esta cuenta»: salir no borra la razón social.
 * Con sesión y sin empresa, sí: esa persona todavía no dio de alta la suya.
 */
export function relatoSinEmpresa(
  libroDisponible: boolean,
  conSesion: boolean,
): { titulo: string; detalle: string } {
  if (!libroDisponible) {
    return {
      titulo: "Todavía no hay razón social.",
      detalle: "No se pudo consultar la cuenta.",
    };
  }
  if (!conSesion) {
    return {
      titulo: "Hay que entrar.",
      detalle: "La razón social se ve después de entrar.",
    };
  }
  return {
    titulo: "Todavía no hay razón social.",
    detalle: "Esta cuenta todavía no tiene razón social.",
  };
}
