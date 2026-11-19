-- Tope del segundo factor por persona.
--
-- El tope de cinco códigos vivía solo en cada entrada (auth_entradas.intentos_fallidos)
-- y cada contraseña correcta abría una entrada nueva: con la contraseña se probaban
-- códigos TOTP sin límite, cinco por entrada. Ahora el servicio cuenta los fallos de
-- segundo factor de la persona en los últimos quince minutos, igual que
-- fallos_de_contrasena cuenta las contraseñas: con diez ya no abre entradas nuevas ni
-- deja probar códigos en la abierta.
--
-- El evento 'segundo_factor_fallido' lleva la entrada en identificador y a la persona
-- en actor_id (repositorio.ts, registrarFalloDeEntrada); se cuenta por actor_id. Lo
-- escriben la puerta del portal y la de Operación por igual.
--
-- Aditivos: la función, su permiso y el índice. No toca datos.

SET search_path TO public;

CREATE FUNCTION fallos_de_segundo_factor(p_user uuid, p_desde timestamptz)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM audit_log
  WHERE accion = 'segundo_factor_fallido'
    AND actor_id = p_user
    AND ocurrido_en >= p_desde
$$;

REVOKE ALL ON FUNCTION fallos_de_segundo_factor(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fallos_de_segundo_factor(uuid, timestamptz) TO plataforma_cliente;

-- Mismo criterio que audit_log_entrada_fallida_idx (0025), por actor_id.
CREATE INDEX audit_log_segundo_factor_fallido_idx
  ON audit_log (actor_id, ocurrido_en)
  WHERE accion = 'segundo_factor_fallido';
