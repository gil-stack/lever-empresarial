"use client";

import type { ChangeEvent, ReactNode } from "react";

/** Un selector que envía su formulario al elegir otra opción; sin JavaScript lo envía el botón del formulario. */
export function SelectorQueEnvia({ id, name, defaultValue, children }: { id: string; name: string; defaultValue: string; children: ReactNode }) {
  const alCambiar = (evento: ChangeEvent<HTMLSelectElement>) => evento.currentTarget.form?.requestSubmit();
  return (
    <select id={id} name={name} defaultValue={defaultValue} onChange={alCambiar}>
      {children}
    </select>
  );
}
