"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * El botón que envía un formulario. Mientras la acción corre se desactiva,
 * dice «Enviando…» y lleva `aria-busy`: un doble clic o un segundo Enter no
 * mandan la operación dos veces.
 *
 * Lee el estado del `<form>` que lo contiene (`useFormStatus`), con `action`
 * o con un `onSubmit` que arranca una transición. Si la acción la lleva el
 * padre con `useActionState`, pásale su `pendiente`.
 */
export function BotonEnviar({
  children,
  enviando = "Enviando…",
  pendiente = false,
  className = "boton",
  disabled = false,
  ...resto
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-busy" | "children"> & {
  children: ReactNode;
  /** Lo que dice mientras la acción corre. */
  enviando?: string;
  /** El pendiente de `useActionState`, cuando el formulario lo lleva el padre. */
  pendiente?: boolean;
}) {
  const { pending } = useFormStatus();
  const ocupado = pending || pendiente;
  return (
    <button {...resto} type="submit" className={className} disabled={disabled || ocupado} aria-busy={ocupado || undefined}>
      {ocupado ? enviando : children}
    </button>
  );
}
