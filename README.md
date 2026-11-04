# Plataforma

Consola de control de gastos para una razón social mexicana.

## Desarrollo

```bash
npm install
npm run dev
```

`/salud` responde `ok` y no imprime configuración.

## Este corte

Fase 1, integrada: una persona entra, da de alta una razón social y ve la consola vacía. El teléfono existe, está vacío y no comparte el menú de la consola. Las funciones corren en `iad1` con runtime Node.js.

El maestro de personas vive en la consola: jefe, centro de costo, fecha de baja y CLABE con el dígito 3, 7 y 1. Hacen falta dos liberadores distintos para que la empresa esté operable. El contador no libera. No se dispersa dinero.

La cookie `sesion` y el alta viven en `src/server`. La puerta llama a `abrirCuenta` y a `darDeAltaEmpresa`. Una forma válida se guarda. Un segundo RFC en la misma cuenta no entra. La auditoría de ese alta se inserta en la misma transacción.

El servidor lee el connection string agrupado y no migra al arrancar. Las migraciones se aplican a mano:

```bash
export DATABASE_URL_UNPOOLED
./db/migrate.sh
```

`DATABASE_URL_UNPOOLED` es el string directo de la base `plataforma`. El valor no va en el repositorio. La rama de Neon para que preview no comparta el libro de production se crea con `./db/preview-branch.sh`. El detalle está en `db/README.md`.

## Política de comprobantes

La consola muestra los cuatro cajones —Viáticos, Proveedores, Impuestos y Nómina— con el saldo que sale de sus asientos. La política nace en cinco días y cinco comprobantes vencidos, y se puede escribir distinto para cada persona. Las categorías no traen tope. El umbral de proveedores no trae monto. No hay dispersión ni SPEI en este corte. La pantalla está en `/consola/politica`.

## Precios

`/precios` y la consola leen `platform_pricing.suscripcion_centavos`. Vacío, las dos dicen «cifra no publicada». Por persona, por tarjeta y de implementación se muestran en cero. No hay un monto sembrado.

`OPERADORES_PLATAFORMA` lista los correos que pueden publicar ese monto una vez y registrar la suscripción como aceptada. Sin monto publicado, ese paso no existe. El valor no va en el repositorio.

## Proveedores

El alta vive en la consola, en `/consola/proveedores`, con la barra de la izquierda. Pide RFC, razón social, CLABE de 18 dígitos y la constancia en PDF. El duplicado de RFC no entra. Cambiar la CLABE deja la anterior en el historial. Los dieciocho dígitos se ven completos. El nombre del banco solo aparece si los tres primeros están en el catálogo tradicional; si no, la institución queda pendiente del participante.

La lista del artículo 69-B está en `/consola/lista-69b`. Si el RFC aparece, o si todavía no hay archivo, el proveedor puede existir y no hay botón de pago. No se envía dinero.

`/telefono` no lleva proveedores, la CLABE ni la lista 69-B, y no usa el menú de la consola. Para verlo hace falta haber entrado con el segundo factor.

## Autenticación

Todo el mundo entra con correo, contraseña y un segundo factor: una passkey, o un código TOTP de una app autenticadora si no tiene passkey. Sin eso el portal no abre, ni la consola ni el teléfono. Al primer ingreso hay que registrar uno de los dos. Los códigos de respaldo se muestran una vez y se guardan como hash.

Perder el segundo factor no se resuelve con un correo. La persona lo pide y otra persona, de `OPERADORES_PLATAFORMA`, verifica su identidad y aprueba. Esa aprobación cierra las sesiones y quita los factores. La cuenta sigue cerrada hasta que, con la contraseña, se registra uno nuevo.

`AUTENTICACION_LLAVE_TOTP` es la llave de 32 bytes, en base64, con la que se cifra la semilla TOTP. No va en el repositorio. Se genera con `openssl rand -base64 32`. Sin ella se puede entrar con passkey y no con app autenticadora. `AUTENTICACION_DOMINIOS` lista, separada por comas, los dominios propios donde una passkey es válida. En Vercel se suman los dominios del despliegue. La migración es `0016_autenticacion_fuerte.sql`, con el mismo comando de siempre, y hay que aplicarla antes de servir este corte: borra las sesiones anteriores.
