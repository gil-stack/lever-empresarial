-- Copia local del inventario de tarjetas del procesador, para buscar y filtrar.
--
-- El procesador solo entrega la lista de plásticos por páginas, sin búsqueda.
-- Con decenas de miles de tarjetas no se puede leer todo en cada visita a
-- Operación → Tarjetas, así que Lever guarda aquí una copia que se refresca por
-- partes (tarjetas_inventario_lectura lleva por qué página va) y la pantalla
-- busca, filtra y pagina en la base.
--
-- Solo guarda lo que ya pinta la pantalla: id del plástico, últimos 4 dígitos,
-- estado, saldo y cliente del procesador. Nunca el número completo ni el CVV.
--
-- Aditiva: dos tablas con RLS y sus permisos. No toca datos.

SET LOCAL lock_timeout = '2s';

SET search_path TO public;

CREATE TABLE tarjetas_inventario (
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  ambiente text NOT NULL,
  id_tarjeta integer NOT NULL,
  terminacion text NOT NULL,
  estado text NOT NULL,
  saldo_centavos bigint,
  -- 0: el plástico no tiene cliente en el procesador.
  idep_cliente integer NOT NULL DEFAULT 0,
  -- El nombre del cliente del procesador cuando no es una empresa de Lever, si se pudo leer.
  nombre_cliente text,
  con_titular boolean NOT NULL DEFAULT false,
  vista_en timestamptz NOT NULL,
  PRIMARY KEY (operator_id, ambiente, id_tarjeta),
  CONSTRAINT tarjetas_inventario_ambiente CHECK (ambiente IN ('sandbox', 'produccion')),
  CONSTRAINT tarjetas_inventario_id CHECK (id_tarjeta > 0),
  CONSTRAINT tarjetas_inventario_terminacion CHECK (terminacion ~ '^[0-9]{4}$'),
  CONSTRAINT tarjetas_inventario_estado CHECK (estado IN ('inStock', 'inactive', 'active', 'blocked', 'cancelled')),
  CONSTRAINT tarjetas_inventario_idep CHECK (idep_cliente >= 0),
  CONSTRAINT tarjetas_inventario_nombre CHECK (nombre_cliente IS NULL OR char_length(nombre_cliente) <= 200)
);

CREATE INDEX tarjetas_inventario_por_terminacion ON tarjetas_inventario (operator_id, ambiente, terminacion);
CREATE INDEX tarjetas_inventario_por_cliente ON tarjetas_inventario (operator_id, ambiente, idep_cliente);
CREATE INDEX tarjetas_inventario_por_estado ON tarjetas_inventario (operator_id, ambiente, estado);

COMMENT ON TABLE tarjetas_inventario IS
  'Copia del inventario de plásticos del procesador (getCardsList), para buscar y paginar en Operación → Tarjetas. Sin número completo ni CVV.';

CREATE TABLE tarjetas_inventario_lectura (
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  ambiente text NOT NULL,
  -- Cuándo empezó la vuelta en curso (o la última); lo que no se vio desde entonces se borra al terminarla.
  empezada_en timestamptz,
  -- La página que sigue; nula si no hay vuelta en curso.
  pagina_siguiente integer,
  paginas integer,
  completa_en timestamptz,
  total integer,
  error text,
  error_en timestamptz,
  -- Quien lee tiene la vuelta hasta esta hora; así dos visitas no leen a la vez.
  ocupada_hasta timestamptz,
  PRIMARY KEY (operator_id, ambiente),
  CONSTRAINT tarjetas_inventario_lectura_ambiente CHECK (ambiente IN ('sandbox', 'produccion')),
  CONSTRAINT tarjetas_inventario_lectura_pagina CHECK (pagina_siguiente IS NULL OR pagina_siguiente > 0),
  CONSTRAINT tarjetas_inventario_lectura_error CHECK (error IS NULL OR char_length(error) <= 80)
);

COMMENT ON TABLE tarjetas_inventario_lectura IS
  'Por operador y ambiente: por qué página va la lectura del inventario del procesador y cuándo terminó la última.';

ALTER TABLE tarjetas_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarjetas_inventario FORCE ROW LEVEL SECURITY;
ALTER TABLE tarjetas_inventario_lectura ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarjetas_inventario_lectura FORCE ROW LEVEL SECURITY;

CREATE POLICY tarjetas_inventario_sofipo ON tarjetas_inventario
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY tarjetas_inventario_lectura_sofipo ON tarjetas_inventario_lectura
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

REVOKE ALL ON tarjetas_inventario FROM PUBLIC;
REVOKE ALL ON tarjetas_inventario_lectura FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON tarjetas_inventario TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON tarjetas_inventario_lectura TO plataforma_sofipo;
