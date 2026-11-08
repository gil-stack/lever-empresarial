"use client";

import "@/estilo/escena.css";

import { useEffect, useRef } from "react";

import type { ClaveEscena, ClaveTema, ClaveTono } from "./catalogo";

type Motor = typeof import("./motor");

/** Como el fondo de la plataforma del diseño: 85 % de resolución, DPR máximo 2 y un cuadro de cada tres. */
const ESCALA = 0.85;
const DPR_MAXIMO = 2;
const SALTO = 3;
/** El instante con el que el diseño pinta una escena quieta. */
const TIEMPO_QUIETO = 4;
const LUZ_EN_REPOSO = [-0.3, -0.8] as const;
/** Sin cursor por este tiempo, la luz vuelve a su vaivén lento. */
const PAUSA_DEL_CURSOR_MS = 2600;
/**
 * Equipo lento: tras calentar se mide en ventanas de 60 cuadros (un segundo a 60 Hz). Si dibujar
 * bloquea más de 12 ms en promedio (casi un cuadro de 60 Hz) o la página baja de 40 cuadros por
 * segundo, el fondo queda quieto.
 */
const CUADROS_DE_CALENTAMIENTO = 20;
const CUADROS_POR_VENTANA = 60;
const DIBUJO_LENTO_MS = 12;
const INTERVALO_LENTO_MS = 1000 / 40;
/**
 * Un solo dibujo que bloquea más que una tarea larga delata un equipo que pinta sin GPU (una máquina virtual, un
 * escritorio remoto): el fondo se queda quieto en ese momento, sin esperar el calentamiento ni la ventana.
 */
const DIBUJO_BLOQUEANTE_MS = 50;
/** En `sessionStorage`: recargar la página no vuelve a medir. */
const RECUERDO_LENTO = "lever-fondo-lento";

/** Una vez que el equipo resultó lento, el fondo se queda quieto en toda la sesión del navegador. */
let equipoLento = false;

function recordarEquipoLento() {
  equipoLento = true;
  try {
    sessionStorage.setItem(RECUERDO_LENTO, "1");
  } catch {
    // Sin almacenamiento la decisión dura lo que dure esta carga.
  }
}

function equipoLentoRecordado(): boolean {
  try {
    return sessionStorage.getItem(RECUERDO_LENTO) === "1";
  } catch {
    return false;
  }
}

export interface PropsFondoEscena {
  escena: ClaveEscena;
  tono: ClaveTono;
  tema: ClaveTema;
  /** Fondo animado. Con «reducir movimiento» del sistema queda quieto aunque sea `true`. */
  movimiento?: boolean;
  /** La luz sigue al cursor. */
  luzDinamica?: boolean;
  /** Color base del tono «Tu color». */
  colorPropio?: string;
}

/**
 * La escena fija detrás de la app. El motor se carga después de montar, así
 * que la primera pintura sale con el color del tema y la escena llega luego.
 */
export function FondoEscena({
  escena,
  tono,
  tema,
  movimiento = true,
  luzDinamica = true,
  colorPropio,
}: PropsFondoEscena) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const apariencia = useRef({ escena, tono, tema, colorPropio });
  const repintar = useRef(() => {});

  useEffect(() => {
    apariencia.current = { escena, tono, tema, colorPropio };
    repintar.current();
  }, [escena, tono, tema, colorPropio]);

  useEffect(() => {
    const lienzo = lienzoRef.current;
    const contexto = lienzo?.getContext("2d");
    if (!lienzo || !contexto) return;

    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!equipoLento) equipoLento = equipoLentoRecordado();
    const luz: [number, number] = [...LUZ_EN_REPOSO];
    const cursor: [number, number] = [...LUZ_EN_REPOSO];
    let motor: Motor | null = null;
    let activo = true;
    let raf = 0;
    let visible = true;
    let sucio = true;
    let n = 0;
    let cuadros = 0;
    let msDibujando = 0;
    let ultimoCuadro = 0;
    let calentados = 0;
    let ventanaIntervalos = 0;
    let ventanaMs = 0;
    let ventanaDibujos = 0;
    let ventanaMsDibujo = 0;
    let ultimoCursor = -Infinity;
    let estado = "cargando";
    lienzo.dataset.estado = estado;

    const fijarEstado = (nuevo: string) => {
      estado = nuevo;
      lienzo.dataset.estado = nuevo;
    };

    const quieto = () => !movimiento || reducir.matches || equipoLento;

    /** Tamaño del lienzo en píxeles: 85 % de la pantalla, con DPR máximo 2. */
    const medida = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAXIMO) * ESCALA;
      return [Math.max(2, Math.round(lienzo.offsetWidth * dpr)), Math.max(2, Math.round(lienzo.offsetHeight * dpr))];
    };

    /** Pinta un cuadro y devuelve cuánto bloqueó el hilo principal, en ms. */
    const dibujar = (tiempo: number) => {
      if (!motor) return 0;
      const [ancho, alto] = medida();
      if (lienzo.width !== ancho || lienzo.height !== alto) {
        lienzo.width = ancho;
        lienzo.height = alto;
      }
      const inicio = performance.now();
      motor.pintar(contexto, ancho, alto, { ...apariencia.current, luz, tiempo });
      const ms = performance.now() - inicio;
      msDibujando += ms;
      cuadros += 1;
      sucio = false;
      lienzo.dataset.cuadros = String(cuadros);
      lienzo.dataset.ms = (msDibujando / cuadros).toFixed(2);
      lienzo.dataset.gpu = motor.usaGpu() ? "si" : "no";
      return ms;
    };

    const reiniciarMedicion = () => {
      ultimoCuadro = 0;
      calentados = 0;
      ventanaIntervalos = 0;
      ventanaMs = 0;
      ventanaDibujos = 0;
      ventanaMsDibujo = 0;
    };

    /** Mide una ventana de cuadros; devuelve `true` si el equipo no da para animar el fondo. */
    const midiendoEsLento = (ts: number) => {
      if (!ultimoCuadro) return false;
      if (calentados < CUADROS_DE_CALENTAMIENTO) {
        calentados += 1;
        return false;
      }
      ventanaIntervalos += 1;
      ventanaMs += ts - ultimoCuadro;
      if (ventanaIntervalos < CUADROS_POR_VENTANA) return false;
      const lento =
        ventanaMs / ventanaIntervalos > INTERVALO_LENTO_MS ||
        (ventanaDibujos > 0 && ventanaMsDibujo / ventanaDibujos > DIBUJO_LENTO_MS);
      ventanaIntervalos = 0;
      ventanaMs = 0;
      ventanaDibujos = 0;
      ventanaMsDibujo = 0;
      return lento;
    };

    const detener = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const actualizar = () => {
      if (!activo || !motor) return;
      if (quieto()) {
        detener();
        const siguiente = equipoLento ? "lento" : "quieto";
        if (estado !== siguiente) {
          // Al quedar quieta, la escena se pinta una vez con la luz en reposo.
          luz[0] = LUZ_EN_REPOSO[0];
          luz[1] = LUZ_EN_REPOSO[1];
          sucio = true;
        }
        if (sucio) dibujar(TIEMPO_QUIETO);
        fijarEstado(siguiente);
      } else if (document.hidden || !visible) {
        detener();
        fijarEstado("pausa");
      } else if (!raf) {
        // El tiempo en pausa no cuenta para medir si el equipo es lento.
        reiniciarMedicion();
        sucio = true;
        raf = requestAnimationFrame(cuadro);
        fijarEstado("vivo");
      }
    };

    const cuadro = (ts: number) => {
      raf = 0;
      if (!activo || document.hidden || !visible || quieto()) return;
      if (midiendoEsLento(ts)) {
        recordarEquipoLento();
        actualizar();
        return;
      }
      ultimoCuadro = ts;
      const t = ts / 1000;
      const sinCursor = !luzDinamica || ts - ultimoCursor > PAUSA_DEL_CURSOR_MS;
      const destinoX = sinCursor ? LUZ_EN_REPOSO[0] + 0.22 * Math.sin(t * 0.21) : cursor[0];
      const destinoY = sinCursor ? LUZ_EN_REPOSO[1] + 0.08 * Math.cos(t * 0.27) : cursor[1];
      luz[0] += (destinoX - luz[0]) * 0.07;
      luz[1] += (destinoY - luz[1]) * 0.07;
      n += 1;
      if (sucio || n % SALTO === 0) {
        // La primera pintura también compila el shader: no dice cuánto cuesta pintar en este equipo.
        const primera = cuadros === 0;
        const ms = dibujar(t);
        if (!primera && ms > DIBUJO_BLOQUEANTE_MS) {
          // Sin otra pintura, que bloquearía igual: la escena se queda en este cuadro y la luz vuelve al reposo
          // para cuando haya que repintarla quieta (otro tema o tamaño).
          recordarEquipoLento();
          luz[0] = LUZ_EN_REPOSO[0];
          luz[1] = LUZ_EN_REPOSO[1];
          fijarEstado("lento");
          return;
        }
        if (calentados >= CUADROS_DE_CALENTAMIENTO) {
          ventanaDibujos += 1;
          ventanaMsDibujo += ms;
        }
      }
      raf = requestAnimationFrame(cuadro);
    };

    const alMoverCursor = (evento: PointerEvent) => {
      cursor[0] = ((evento.clientX / window.innerWidth) * 2 - 1) * 0.95;
      cursor[1] = ((evento.clientY / window.innerHeight) * 2 - 1) * 0.7 - 0.35;
      ultimoCursor = performance.now();
    };

    repintar.current = () => {
      if (!motor) return;
      sucio = true;
      if (quieto()) dibujar(TIEMPO_QUIETO);
    };

    const observadorTamano = new ResizeObserver(() => {
      const [ancho, alto] = medida();
      if (ancho !== lienzo.width || alto !== lienzo.height) repintar.current();
    });
    observadorTamano.observe(lienzo);
    const observadorVista = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
      actualizar();
    });
    observadorVista.observe(lienzo);
    document.addEventListener("visibilitychange", actualizar);
    reducir.addEventListener("change", actualizar);
    if (luzDinamica) window.addEventListener("pointermove", alMoverCursor, { passive: true });

    import("./motor")
      .then((modulo) => {
        if (!activo) return;
        motor = modulo;
        actualizar();
      })
      .catch((error: unknown) => {
        // Sin motor queda el color liso del tema; la app sigue funcionando.
        console.warn("No se pudo cargar el fondo animado:", error);
        fijarEstado("sin-motor");
      });

    return () => {
      activo = false;
      detener();
      repintar.current = () => {};
      observadorTamano.disconnect();
      observadorVista.disconnect();
      document.removeEventListener("visibilitychange", actualizar);
      reducir.removeEventListener("change", actualizar);
      window.removeEventListener("pointermove", alMoverCursor);
    };
  }, [movimiento, luzDinamica]);

  return (
    <div className="escena-fondo" data-tema={tema} aria-hidden="true">
      <canvas ref={lienzoRef} className="escena-lienzo" />
    </div>
  );
}
