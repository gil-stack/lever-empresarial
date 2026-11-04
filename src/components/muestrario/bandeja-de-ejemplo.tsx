"use client";

import { useState } from "react";

import { IconoAumento, IconoCompra, IconoReembolso } from "@/components/cromo/iconos";
import { Bandeja, type Decision } from "@/components/sistema";

type Muestra = Omit<Decision, "acciones">;

const MUESTRAS: Muestra[] = [
  {
    id: "aumento",
    titulo: "Aumento de límite · Carlos Méndez",
    icono: <IconoAumento />,
    detalle: (
      <>
        <p>Combustible ••8833 · de $25,000.00 a $35,000.00 al mes</p>
        <p>Motivo: ruta extra a Querétaro · Hoy, 11:40</p>
      </>
    ),
    contexto: [
      "Carlos lleva $18,880.00 gastados este mes",
      <strong key="uso">Va en 76% de su límite actual</strong>,
      "Primera solicitud de este tipo",
    ],
  },
  {
    id: "reembolso",
    titulo: "Reembolso · Carlos Méndez",
    icono: <IconoReembolso />,
    detalle: (
      <>
        <p>$296.00 por caseta Palmillas en efectivo · ejemplo, el reembolso todavía no existe</p>
        <p>Motivo: la terminal de la caseta no servía · Hoy, 09:20</p>
      </>
    ),
    contexto: ["Primera solicitud de este tipo"],
  },
  {
    id: "compra",
    titulo: "Solicitud de compra · Daniela Ruiz",
    icono: <IconoCompra />,
    detalle: (
      <>
        <p>Figma · hasta $1,200.00 al mes · ejemplo, la tarjeta todavía no existe</p>
        <p>Motivo: diseño de propuestas para clientes · Ayer, 17:40</p>
      </>
    ),
    contexto: ["Daniela lleva $5,570.00 gastados este mes", "Primera solicitud de este tipo"],
  },
];

/** La bandeja con datos de ejemplo. Decidir aquí no guarda nada. */
export function BandejaDeEjemplo() {
  const [resueltas, setResueltas] = useState<Record<string, "aprobada" | "rechazada">>({});
  const [ultima, setUltima] = useState("");

  function resolver(ids: string[], como: "aprobada" | "rechazada") {
    setResueltas((antes) => ({ ...antes, ...Object.fromEntries(ids.map((id) => [id, como])) }));
    const titulos = MUESTRAS.filter((muestra) => ids.includes(muestra.id)).map((muestra) => muestra.titulo);
    setUltima(`${titulos.join(", ")}: ${como} (ejemplo, no se guardó).`);
  }

  const decisiones: Decision[] = MUESTRAS.filter((muestra) => !resueltas[muestra.id]).map((muestra) => ({
    ...muestra,
    acciones: (
      <>
        <button type="button" className="boton-texto" data-atajo="rechazar" onClick={() => resolver([muestra.id], "rechazada")}>
          Rechazar
        </button>
        <button type="button" className="boton" data-atajo="aprobar" onClick={() => resolver([muestra.id], "aprobada")}>
          Aprobar
        </button>
      </>
    ),
  }));

  return (
    <>
      <Bandeja
        decisiones={decisiones}
        aprobarSeleccionadas={(ids) => resolver(ids, "aprobada")}
        vacio={
          <>
            <p className="vacio-titulo">Nada espera tu decisión.</p>
            <p>
              <button type="button" className="boton-texto" onClick={() => setResueltas({})}>
                Volver a cargar el ejemplo
              </button>
            </p>
          </>
        }
      />
      <p className="nota-saldos" role="status">
        {ultima}
      </p>
    </>
  );
}
