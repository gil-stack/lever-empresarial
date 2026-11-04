import { Icono } from "./iconos";
import { LogoArco } from "./logo-arco";

const BARRAS = [36, 52, 44, 68, 58, 82, 74, 92, 66, 84, 96, 78] as const;

export function VisualHero() {
  return (
    <div className="arco-hero-visual" role="img" aria-label="Vista ilustrativa de una tarjeta ARCO y un panel de control empresarial">
      <div className="arco-orbita" aria-hidden="true" />
      <div className="arco-panel">
        <div className="arco-panel-cabeza">
          <span>Resumen de operación</span>
          <span className="arco-panel-periodo">ESTE MES</span>
        </div>
        <p className="arco-panel-etiqueta">Saldo de la empresa</p>
        <p className="arco-panel-monto">
          $125,450<small>.00 MXN</small>
        </p>
        <div className="arco-grafica" aria-hidden="true">
          {BARRAS.map((altura, indice) => (
            <span key={indice} style={{ height: `${altura}%` }} />
          ))}
        </div>
        <dl className="arco-panel-datos">
          <div>
            <dt>Viáticos</dt>
            <dd>$42,180</dd>
          </div>
          <div>
            <dt>Proveedores</dt>
            <dd>$56,900</dd>
          </div>
          <div>
            <dt>Nómina</dt>
            <dd>$26,370</dd>
          </div>
        </dl>
      </div>

      <div className="arco-tarjeta">
        <div className="arco-tarjeta-cabeza">
          <LogoArco inverso />
          <span>EMPRESARIAL</span>
        </div>
        <div className="arco-tarjeta-media" aria-hidden="true">
          <span className="arco-chip" />
          <svg viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M6 7a10 10 0 0 1 0 10M11 4a15 15 0 0 1 0 16M16 1a20 20 0 0 1 0 22" />
          </svg>
        </div>
        <div className="arco-tarjeta-pie">
          <span>ARCO PAGOS</span>
          <span>•••• 2408</span>
        </div>
      </div>

      <div className="arco-aprobacion">
        <span className="arco-aprobacion-icono">
          <Icono nombre="check" />
        </span>
        <span>
          <strong>Aprobación completa</strong>
          <small>2 de 2 firmas</small>
        </span>
      </div>
      <p className="arco-visual-nota">Vista ilustrativa del producto</p>
    </div>
  );
}
