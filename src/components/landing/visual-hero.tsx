import { Logotipo } from "@/components/cromo/logotipo";

import { Icono } from "./iconos";

const MOVIMIENTOS = [
  { nombre: "Materiales del norte", detalle: "Proveedores · Hoy", monto: "$18,450.00" },
  { nombre: "Viáticos de ventas", detalle: "Comprobante relacionado · Ayer", monto: "$6,280.00" },
  { nombre: "Nómina quincenal", detalle: "Programada · 15 de noviembre", monto: "$42,900.00" },
] as const;

export function VisualHero() {
  return (
    <div className="arco-hero-visual" role="img" aria-label="Vista ilustrativa del control de operación de LEVER">
      <div className="arco-panel">
        <div className="arco-panel-cabeza">
          <Logotipo linea={null} />
          <span className="arco-panel-periodo">RESUMEN DE OPERACIÓN</span>
        </div>
        <div className="arco-panel-resumen">
          <div>
            <p className="arco-panel-etiqueta">Saldo de la empresa</p>
            <p className="arco-panel-monto">$125,450<small>.00 MXN</small></p>
          </div>
          <span className="arco-panel-estado"><i /> Al día</span>
        </div>
        <dl className="arco-panel-datos">
          <div><dt>Por comprobar</dt><dd>3 movimientos</dd></div>
          <div><dt>Por aprobar</dt><dd>1 solicitud</dd></div>
          <div><dt>Centros de costo</dt><dd>4 activos</dd></div>
        </dl>
        <div className="arco-movimientos">
          <p>Actividad reciente</p>
          {MOVIMIENTOS.map((movimiento) => (
            <div className="arco-movimiento" key={movimiento.nombre}>
              <span><strong>{movimiento.nombre}</strong><small>{movimiento.detalle}</small></span>
              <b>{movimiento.monto}</b>
            </div>
          ))}
        </div>
        <div className="arco-aprobacion">
          <span className="arco-aprobacion-icono"><Icono nombre="check" /></span>
          <span><strong>Política aplicada</strong><small>Cada movimiento tiene contexto y trazabilidad</small></span>
        </div>
      </div>
      <p className="arco-visual-nota">Vista ilustrativa del producto</p>
    </div>
  );
}
