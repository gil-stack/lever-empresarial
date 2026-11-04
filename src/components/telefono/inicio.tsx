import type { InicioTelefono } from "@/server/telefono/tipos";

export function Inicio({ persona, empresa }: { persona: InicioTelefono; empresa: string }) {
  return (
    <>
      <p className="kicker-app">Inicio · {empresa}</p>
      <h1>{persona ? `Hola, ${persona.nombre}.` : "Tu acceso de solo lectura."}</h1>
      <p className="lede">Consulta tus topes y los datos fiscales de esta empresa. Aquí no se registran gastos ni se mueve dinero.</p>
      {persona?.bajaEn ? <p className="aviso-app">Tu ficha registra baja el {persona.bajaEn}.</p> : null}
      {!persona ? <p className="aviso-app">Tu membresía no tiene una ficha de persona en el maestro.</p> : null}
      <div className="vacio">
        <p className="vacio-titulo">Sin gastos en este corte</p>
        <p>No hay un expediente de gasto que mostrar. Esta pantalla no inventa pendientes ni comprobantes.</p>
      </div>
    </>
  );
}
