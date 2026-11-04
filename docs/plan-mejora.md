# Plan de mejora de la plataforma

**Corte:** 4 de noviembre de 2026, sobre `main` en `a4e7365`, que es lo que está en producción (fases 1 a 3).
**Qué es:** el plan que reordena el trabajo restante ahora que el dueño es una SOFIPO que opera la plataforma y la vende como SaaS. Decide la arquitectura de los tres portales y el orden de las fases. No es código ni asesoría legal.
**Qué no hace:** no reescribe los informes que lo sostienen. Los cita: la [auditoría de la plataforma](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/auditoria-plataforma.md), el [portal de la SOFIPO](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/portal-sofipo.md), el [portal del cliente](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/portal-cliente.md) y el [plan vigente](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/plan-desarrollo.md). Del plan vigente se conserva todo lo que este texto no declara superado (sección 3.8).

**Decisiones del fundador que este plan ya incorpora:**

- **Tarjeta recargable** (prefondeada contra la cuenta de la empresa en la SOFIPO). El crédito requiere Nivel de Operaciones IV (LACP, art. 36) y queda fuera de este plan.
- **Un solo operador:** la SOFIPO. El software no se vende a otras entidades.
- **El portal de cada cliente incluye cobranza** (cuentas por cobrar), además de pago a proveedores, nómina y tarjetas de gasto.
- **El correo es Resend.** El remitente lo entrega el fundador.

**Prioridad del fundador: funcionalidad primero.** El plan pone por delante que los tres portales funcionen: el de la SOFIPO, con clientes, alertas y operación; el del cliente, con gasto, pagos, nómina y cobranza; y el teléfono. Los reportes regulatorios a las autoridades quedan como trabajo posterior (última línea del documento).

**Una palabra que se separa en este plan.** Hay dos expedientes distintos y no se mezclan:

- El **expediente del gasto** es el de la fase 4 del plan vigente: cargo, comprobante, aprobación y póliza. Vive en el portal del cliente.
- El **expediente del cliente (KYB)** es el que exige la regulación de PLD: documentos, propietarios reales, listas y grado de riesgo de la empresa. Vive en el portal de la SOFIPO.

---

## 1. Qué está mal hoy y por qué

**La causa es una sola.** La plataforma se construyó para un negocio en el que la empresa era la cuenta, la persona pertenecía a una empresa y el dinero vivía con terceros. El dueño real es una entidad regulada que origina, supervisa y custodia a muchos clientes. Casi todos los hallazgos de los tres informes son síntomas de ese supuesto.

| Qué está mal | Por qué importa para una SOFIPO | Fase que lo resuelve |
| --- | --- | --- |
| La base impone una persona por empresa, y el «operador» es una lista de correos en una variable de entorno | La SOFIPO no puede operar ni a un segundo cliente. Un contador con dos clientes, o un liberador que también tiene tarjeta, no caben | 4 |
| Cualquiera crea un cliente activo desde la portada, y el formulario de alta también inicia sesión | La ley pide identificar a la empresa antes de iniciar la relación. Hoy la relación empieza sin que la SOFIPO intervenga | 4 cierra la puerta, 5 origina, 10 exige el KYB |
| Las superficies se mezclan: el cliente refresca la lista 69-B de todos y ve el precio de plataforma, y el tarjetahabiente aterriza en la tesorería de su empresa | Un inquilino escribe datos de todos, y una persona ve lo que no le toca. En un SaaS que se vende, cada pantalla tiene que ser de quien la ve | 5 y 6 |
| El aislamiento y los permisos viven solo en la aplicación. No hay RLS, la autorización está repartida en seis archivos, no hay un guardia central de rutas y las pruebas de aislamiento no corren solas | Un filtro olvidado expone a un cliente frente a otro y nadie lo detecta. El portal SOFIPO, que por diseño lee todas las empresas, multiplica ese riesgo | 4 |
| Las cuentas no tienen las defensas de un portal financiero: el administrador teclea la contraseña de otros, no hay segundo factor, no hay límite de intentos y solo se permite una sesión por usuario | Quien suelta dinero tiene que probar que es quien dice ser, y nadie más debe conocer su credencial | 4 y 5 |
| La auditoría no registra el tipo de actor, la superficie ni el motivo, y la regla de «misma transacción» depende de un truco con `xmin` que falla con un `SAVEPOINT` | El portal SOFIPO es parte del sistema automatizado de PLD, que la regulación exige íntegro y auditable. No se puede construir sobre una bitácora frágil | 4 |
| El portal del cliente abre con descargos y precios, no con trabajo | El comprador lo nota en la primera demo | 6 |
| El plan vigente supone que el saldo vive con el participante y el plástico con un emisor externo | Si la SOFIPO capta el dinero de la empresa, su libro es el registro de esa cuenta. Cambia quién responde por cada peso en las fases de dinero | 15 y 16 |

**Por qué se corrige ahora y no después.** Cada fase nueva agrega tablas que deducen la empresa a partir del usuario. Hoy son siete repositorios. Después del expediente del gasto y del CFDI serían cerca del doble, y el cambio tocaría pantallas que ya habrían pasado su cierre de calidad. El costo de corregir solo sube.

**Lo que está bien y se conserva.** El libro defiende sus reglas en la base: triggers, `CHECK`, dinero en centavos, historial de la CLABE que no se pisa, dos firmas forzadas en Postgres, 69-B que falla cerrado y archivos privados con hash. La sesión base es correcta y el sistema visual es reutilizable. Nada de eso se tira. El trabajo es cambiar quién entra, por dónde entra y qué puede tocar.

---

## 2. Lo que este plan decide

Cada decisión lleva su porqué. Las que dependen del fundador o del oficial de cumplimiento están en las secciones 5 y 6.

1. **Un libro, un núcleo de dominio y tres superficies, en dos proyectos de Vercel.** El portal SOFIPO va en un proyecto propio. El portal del cliente y el teléfono comparten otro proyecto. *Por qué:* el portal interno necesita su propio firewall, sus variables y su política de sesión, y su código no debe viajar en el paquete que descarga un cliente. El teléfono comparte empresa y datos con el portal del cliente, y separarlo en un tercer proyecto agrega un despliegue sin agregar una pared.
2. **La seguridad a nivel de filas (RLS) entra antes del portal SOFIPO, no después.** La auditoría la ponía en cuarto lugar. *Por qué:* el portal SOFIPO es el primer código que lee todas las empresas a propósito. Abrirlo con el aislamiento solo en la aplicación es abrirlo sin la segunda pared.
3. **El personal de la SOFIPO nunca actúa como el cliente.** Ve, origina, congela y aprueba lo suyo. No libera, no aprueba y no firma por una empresa. Esto se impone en la base con permisos del rol de conexión, no solo en la pantalla. *Por qué:* las dos firmas del cliente pierden sentido si una tercera persona, de otra institución, puede ocupar una.
4. **El KYB y la envolvente de riesgo van antes de preparar dinero.** La originación del cliente (fase 10) va antes de la liberación de proveedores (fase 11). *Por qué:* así el botón de liberar nace con todas sus razones de estar apagado (cliente sin expediente aprobado, beneficiario sin filtrar contra listas, monto fuera de la envolvente) y no se tiene que rehacer.
5. **Las credenciales de los rieles no viven en el proyecto que atiende al cliente.** El cliente deja una instrucción liberada en el libro, y un servicio interno, con las credenciales del participante y del emisor, la envía. *Por qué:* un error en una pantalla del cliente no debe poder usar una llave de dinero.
6. **La bitácora se sella por tramos, no se encadena fila por fila.** *Por qué:* una cadena por fila obliga a serializar todas las escrituras de auditoría de todos los clientes en un solo candado. Un sello periódico, encadenado al sello anterior, detecta igual una manipulación directa, sin volverse el cuello de botella.
7. **Una fase se cierra en una URL desplegada, con la migración aplicada en los dos libros de Neon.** *Por qué:* las fases 2 y 3 llegaron a su review final con la validación hecha en local, sin Blob o sin migraciones en Neon. Eso se vuelve condición de entrada al cierre, no una corrección posterior.
8. **La cobranza lee facturas que la empresa ya timbró; no timbra.** *Por qué:* el producto no es PAC, y la empresa ya factura en su propio sistema. Pedirle que cambie de facturador para poder cobrar frenaría la adopción. Es el mismo criterio que proveedores, del otro lado.

---

## 3. Arquitectura de los tres portales

### 3.1 Principio

Un libro en Neon, un núcleo de dominio compartido (reglas de RFC, CLABE, centavos, CFDI, 69-B, estados y permisos) y tres superficies. Cada superficie tiene su identidad, su sesión, su rol de base de datos y su dominio. El libro no se parte, porque la SOFIPO necesita ver a todos sus clientes sobre los mismos datos. Lo que se separa es la puerta.

| Superficie | Quién entra | Para qué | Dominio | Proyecto de Vercel |
| --- | --- | --- | --- | --- |
| Portal SOFIPO | Personal de la SOFIPO | Originar, supervisar, cumplir y operar a todos los clientes | `operacion.<dominio>` | Propio |
| Portal del cliente | Miembros de una empresa cliente | Controlar el gasto, pagar a proveedores, dispersar nómina y cobrar a sus propios clientes | `app.<dominio>` | Compartido con el teléfono |
| Teléfono | Tarjetahabientes | Cerrar su propio gasto | `m.<dominio>` | Compartido con el portal del cliente |

`<dominio>` es decisión del fundador (sección 5).

### 3.2 Tenencia

El modelo pasa de «la empresa es la cuenta» a tres niveles:

- **Operador.** Es la SOFIPO, y es el único: así lo decidió el fundador. Se guarda como una fila porque es el ancla de toda la configuración de plataforma: planes y precios, lista 69-B, catálogos, envolventes de riesgo, remitente de correo y, en las fases 15 y 16, la configuración del participante y del emisor. *Por qué una tabla para una fila:* separa con nitidez lo que es de la plataforma de lo que es de cada empresa, y las políticas de RLS del portal SOFIPO se escriben contra ella. No se construye nada para un segundo operador: ni marca blanca, ni aislamiento entre operadores, ni alta de operadores.
- **Empresa cliente.** Un RFC, como hoy. Gana **ciclo de vida**: prospecto, en alta, activa, suspendida y baja, con quién la originó y cuándo se activó. Las acciones de dinero exigen «activa». Gana también una **marca de demostración**: una empresa de demostración puede recorrer la interfaz con datos de muestra y nunca puede activarse para dinero. Las empresas de prueba que hoy están en producción quedan como demostración.
- **Personas.** Una identidad por correo, global. La pertenencia a una empresa es una **membresía** (persona × empresa) con estado (invitada, activa, suspendida) y **varios roles**. El personal de la SOFIPO es otra entidad, separada de las membresías: una persona de la SOFIPO no es miembro de la empresa que atiende, entra con su rol y queda registrada como tal.

Se elimina la regla «una persona, una empresa». Se conserva «un RFC por cliente» y «dos liberadores distintos», que ahora cuenta personas y no filas.

**Migración de lo que hay en producción.** Se crea la fila del operador. Los correos de la variable `OPERADORES_PLATAFORMA` pasan a ser personal de la SOFIPO con rol de administración de plataforma, con un evento de auditoría de migración. Cada membresía actual pasa a tener su rol actual en la tabla de roles. La variable se borra después de la migración.

### 3.3 Roles por portal

Una sola **matriz de capacidades** en el núcleo reemplaza las reglas de los seis archivos de hoy. Cada capacidad tiene nombre y pertenece a una superficie. Una capacidad de una superficie no se puede asignar en otra, y todo el código pregunta lo mismo: «¿este contexto tiene esta capacidad?».

**Portal SOFIPO.** Los roles salen del [portal de la SOFIPO, 9.3](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/portal-sofipo.md). Cada uno se enciende cuando su fase le da trabajo, porque un rol sin pantalla confunde a quien lo asigna.

| Rol | Entra en la fase | Lo esencial |
| --- | --- | --- |
| Administración de accesos (TI) | 5 | Propone altas y bajas de roles. No tiene roles de negocio |
| Originación | 5 (alta y activación), 10 (KYB) | Integra el alta. No aprueba lo que integró |
| Aprobador de plataforma | 5 | Segunda firma de activaciones, suspensiones, precios y accesos |
| Auditoría interna | 5 | Lee todo, incluida la bitácora. No modifica nada |
| Dirección | 5 | Tableros y aprobación en su nivel |
| Analista y oficial de cumplimiento | 10 (listas), 14 (alertas y casos) | Sin permisos comerciales. Única superficie que ve casos PLD |
| Analista y jefe de riesgo | 10 | Envolventes y límites con doble firma |
| Soporte y UNE | 14 | Tickets y aclaraciones. Ve datos enmascarados. No ve casos PLD |
| Tesorería y SPEI | 15 | Conciliación, devoluciones y CEP |
| Operación de tarjetas | 16 | Ciclo de vida del plástico y contracargos |

Reglas de segregación que se imponen en la base, no en la pantalla: nadie aprueba lo que pidió, quien integra un expediente no lo aprueba, quien administra accesos no tiene roles de negocio, cumplimiento no tiene permisos comerciales, y una combinación incompatible de roles se rechaza al asignarla. Dar un rol de la SOFIPO pide dos personas: el administrador de accesos propone y el dueño del rol aprueba.

**Portal del cliente.** Los cinco roles de hoy (administrador, solicitante, liberador, contador y tarjetahabiente), ahora **combinables**: el administrador puede liberar y el liberador puede tener tarjeta. Se suma un sexto rol, **cobranza**, desde la fase 13. Dos ajustes: el administrador ve la póliza en solo lectura, y el solicitante no se ofrece en la pantalla hasta que la fase 7 le da trabajo.

**Teléfono.** Una sola capacidad base: ser tarjetahabiente, es decir, una persona del maestro con tarjeta o con derecho a reembolso. En la fase 9 se suma aprobar desde el teléfono si la persona es jefe en el maestro.

### 3.4 Autenticación

| | Portal SOFIPO | Portal del cliente | Teléfono |
| --- | --- | --- | --- |
| Cómo se entra | SSO con el proveedor de identidad de la SOFIPO, o contraseña con segundo factor (decisión 3) | Invitación por correo con enlace de un solo uso. La persona fija su contraseña y verifica su correo. Hay recuperación | Enlace o código de un solo uso al correo. Sin contraseña. WhatsApp cuando exista el proveedor |
| Segundo factor | Obligatorio para todos | Obligatorio para administrador y liberador. Opcional para los demás | La llave del dispositivo (passkey o biometría) para actos sensibles desde la fase 16 |
| Sesión | Corta, con vencimiento por inactividad | Media, con vencimiento por inactividad | Larga, ligada al dispositivo |
| Re-autenticación | Antes de cada acto sensible: activar, suspender, aprobar, asignar roles o cambiar parámetros | Antes de asignar roles, cambiar la CLABE de un proveedor, dar una factura por incobrable y, desde la fase 11, liberar | Antes de ver datos de la tarjeta (fase 16) |
| Cierre remoto | Por administración de accesos | Por el administrador del cliente y por la SOFIPO | Por el administrador del cliente y por la SOFIPO. La baja del empleado cierra sus sesiones el mismo día |

Las cifras exactas de duración e inactividad las fija el oficial de cumplimiento contra la regulación de medios electrónicos (sección 6). El plan no las inventa.

Defensas comunes a las tres superficies: una cookie distinta por superficie, ligada a su dominio, para que la sesión del teléfono no abra el portal SOFIPO; varias sesiones por persona, cada una con superficie, nivel de autenticación, último uso y origen, y cada una cerrable; límite de intentos por correo y por origen, con bloqueo temporal; auditoría de entradas, salidas y fallos; y encabezados que impiden enmarcar las pantallas en otro sitio.

**Se elimina:** el alta pública de la portada y el alta que también inicia sesión.

### 3.5 Aislamiento y RLS

Dos paredes, y la segunda no depende de que la primera esté bien.

**Primera pared, en la aplicación.** Cada petición resuelve una sola vez un **contexto de tenencia**: operador, superficie, tipo de actor (personal de la SOFIPO, miembro o sistema), empresa elegida y validada contra las membresías, y capacidades. Los repositorios reciben ese contexto y ya no deducen la empresa del usuario. La empresa se elige en la ruta y nunca sirve como autorización. Un **guardia central** de rutas exige que cada ruta declare su superficie y su capacidad. Una ruta sin declaración no se publica, y una ruta que no pertenece al dominio que la pide responde como inexistente.

**Segunda pared, en Postgres.** Cinco roles de base de datos, cada uno con su propio connection string:

| Rol de base | Lo usa | Puede |
| --- | --- | --- |
| Migrador | Solo el comando de migrar | Es el único dueño de las tablas |
| Cliente | Portal del cliente | Leer y escribir filas de la empresa del contexto |
| Teléfono | Teléfono | Leer y escribir solo las filas personales de la persona del contexto: sus tarjetas, sus expedientes del gasto y sus reembolsos. No tiene permiso sobre cajones, proveedores, nómina, cobranza ni política completa |
| SOFIPO | Portal SOFIPO | Leer entre empresas solo a través de vistas propias, acotadas al operador. Escribir solo lo de la SOFIPO (ciclo de vida, envolventes, casos y aprobaciones de plataforma). Sin permiso de escribir aprobaciones, órdenes de pago, lotes ni cobros de un cliente |
| Sistema | Trabajos programados y avisos externos | Lo que cada trabajo necesita, nada más |

Ninguno de los roles de aplicación es dueño de las tablas ni puede saltarse RLS. Cada transacción fija sus variables de contexto (operador, empresa, actor y superficie) con un ajuste local a esa transacción. Ese detalle es una restricción técnica, no estilo: Neon agrupa conexiones en modo transacción, y un ajuste de sesión podría filtrarse a la petición de otro cliente. Por eso toda consulta de negocio va dentro de una transacción explícita.

Reglas que quedan para cada tabla nueva:

- Llave compuesta de identificador y empresa como regla, en lugar de un trigger por tabla.
- Toda tabla con empresa tiene RLS activa y política. Una prueba de CI falla si falta alguna de las dos.
- Las claves de los archivos en Blob llevan operador y empresa, y se sirven por una ruta que valida el contexto.
- Una lectura del personal de la SOFIPO sobre datos de un cliente exige motivo y deja evento (3.6).

### 3.6 Auditoría

- **Una tabla nueva** hacia adelante. La actual se conserva como histórico de solo lectura. Cada evento guarda operador, empresa (vacía en actos de plataforma), tipo de actor, actor, superficie, acción tomada de un catálogo, entidad, identificador, motivo, identificador de petición, origen y el cambio (antes y después) con claves permitidas. Nunca guarda secretos, PAN ni contraseñas.
- **Una sola función** de auditar, usada por todos los módulos. Reemplaza los `INSERT` sueltos de hoy.
- **La regla de «misma transacción»** se comprueba contra el identificador de transacción guardado en el propio evento, no contra `xmin`.
- **Sellado por tramos:** un trabajo del sistema calcula el hash de cada tramo cerrado, encadenado al sello anterior, y guarda una copia del sello fuera de la base.
- **También se audita la lectura:** cada vez que el personal de la SOFIPO abre datos de un cliente, un expediente KYB o un caso.
- **Clase confidencial.** Los eventos de cumplimiento (casos, lecturas por PLD, coincidencias en listas) solo los ven cumplimiento y auditoría. El administrador del cliente ve los accesos de la SOFIPO a su empresa, **excepto** los confidenciales, porque mostrarlos alertaría al cliente sobre una investigación. Este punto lo valida el oficial (sección 6).
- **Retención:** no se borra. La tabla se particiona por mes para sostener por lo menos los 10 años que piden las disposiciones de PLD.
- **Sin rastro hoy y con rastro desde la fase 4:** asignar y cambiar roles, carga de la 69-B, entrada, salida e intentos fallidos.

### 3.7 Dominios, despliegue y secretos

- **Repositorio único** con el núcleo como paquete compartido y dos proyectos de Vercel. Cada proyecto tiene sus despliegues de vista previa, y cada vista previa usa su propia rama de Neon, como hoy.
- **Proyecto SOFIPO:** firewall de Vercel y, si la SOFIPO opera desde IP fijas, lista de IP permitidas. Lleva solo sus variables y su connection string con el rol SOFIPO.
- **Proyecto del cliente y del teléfono:** el guardia separa las dos superficies por dominio y usa un connection string distinto para cada una.
- **Correo con Resend:** un solo remitente de la plataforma, el que entregue el fundador, con su dominio verificado (SPF, DKIM y DMARC) antes del primer envío. La llave de Resend vive solo en variables de servidor de cada proyecto. Las vistas previas no envían a direcciones reales. Los correos que salen en nombre de una empresa (recordatorios de cobranza) usan ese mismo remitente con el nombre de la empresa, y las respuestas llegan al correo de la empresa. Así no hay que verificar un dominio por cliente.
- **Servicio de rieles (fases 15 y 16):** recibe las instrucciones liberadas y los avisos firmados del participante y del emisor. Es el único lugar con esas credenciales. Como la tarjeta es recargable, también contesta la autorización de la tarjeta contra el saldo (fase 16), así que tiene requisitos de latencia y disponibilidad que el resto del producto no tiene.
- **Región:** se conserva `iad1` junto a Neon en `aws-us-east-1`. La conveniencia de alojar datos de clientes de una SOFIPO fuera de México la valida el oficial (sección 6).

### 3.8 Qué queda superado del plan vigente

Del [plan vigente](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/plan-desarrollo.md) quedan reemplazadas por este documento:

- «Hay un solo producto y dos pantallas». Ahora son tres superficies y dos proyectos.
- «El operador de la plataforma … es una lista de correos en variable de entorno». Ahora es personal de la SOFIPO con roles.
- `memberships` «Única (`user_id`, `company_id`)» junto con la restricción de una empresa por persona.
- «`companies` gana» el nombre del participante y del emisor. Ahora es configuración del operador.
- «Saldo de la CLABE: la cifra del participante». Con la tarjeta recargable, el saldo es el de la cuenta de la empresa en el libro de la SOFIPO, conciliado contra el participante. La forma exacta depende de la decisión 1 de la sección 5.
- **Cuentas por cobrar.** El plan vigente y el modelo de negocio las dejaban fuera, y el alta rechazaba a quien las pidiera. Por decisión del fundador entran como fase 13, sin timbrar y sin financiarlas.
- La tabla de las diez fases. Ahora son las de la sección 4.
- En la barra de calidad: el punto 3 («Dos pantallas») pasa a «tres superficies, y cada una es de quien la ve». El punto 17 («Nada de banco») se reescribe con cumplimiento, porque la SOFIPO sí es una entidad financiera regulada y lo que la pantalla dice de ella lo fija la norma. Se agregan dos puntos: «el personal de la SOFIPO deja motivo» y «un dato confidencial no se insinúa: el texto de una suspensión es neutro».

Todo lo demás sigue vigente: el modelo de negocio, los defaults de comprobantes, el vocabulario de estados, las reglas de firmas, la regla de no sembrar cifras y la lista de lo que queda fuera, salvo las cuentas por cobrar.

---

## 4. Fases reordenadas

Las fases 1 a 3 están en producción. Las restantes se renumeran a partir de la 4. La tabla dice de dónde viene cada una.

| Fase | Antes | Superficie principal | Entregable | Cierre clave |
| --- | --- | --- | --- | --- |
| **4. Base multi-cliente** | Nueva (auditoría) | Núcleo y base | Las pantallas de hoy, sobre tenencia, RLS, auditoría nueva y CI. Sin alta pública | Postgres rechaza la lectura entre empresas aunque la aplicación olvide el filtro |
| **5. Tres superficies y portal SOFIPO mínimo** | Nueva (auditoría) | SOFIPO, con las tres puertas | La SOFIPO origina, activa, congela y factura clientes desde su portal, con alertas operativas | Ninguna sesión abre otra superficie. El personal no actúa como el cliente |
| **6. Portal del cliente y teléfono** | «Fase 3.5» del informe del cliente | Cliente y teléfono | Pendientes por rol, ruteo por rol, teléfono con identidad, pase de diseño | El tarjetahabiente nunca ve la tesorería |
| **7. Expediente del gasto y bandeja** | 4 | Cliente | Bandeja de excepciones, aprobaciones, póliza de muestra importable | Como el plan vigente, más avisos y export |
| **8. Comprobantes CFDI** | 5 | Cliente y teléfono | El XML dictamina, con buzón de facturas | Como el plan vigente, más duplicados |
| **9. App del tarjetahabiente** | 6 | Teléfono | El gesto, el reembolso y la solicitud de tarjeta, en borrador | Como el plan vigente |
| **10. Originación del cliente (KYB), listas y riesgo** | Nueva (portal SOFIPO) | SOFIPO | Expediente del cliente, filtro contra listas, matriz de riesgo y envolvente | Ningún cliente se activa sin expediente aprobado por otra persona |
| **11. Liberación de proveedores** | 7 | Cliente | Pantalla de liberar, layout y lote de proveedores | Como el plan vigente, más envolvente y listas |
| **12. Dispersión de nómina** | 8 | Cliente | Lote, cruce contra el CFDI tipo N, importación y reportes | Como el plan vigente |
| **13. Cobranza** | Nueva (decisión del fundador) | Cliente | Cuentas por cobrar desde el XML ya timbrado, cobros, antigüedad y recordatorios | Ningún cobro capturado a mano se presenta como recibido |
| **14. Alertas, casos y soporte** | Nueva (portal SOFIPO) | SOFIPO | Motor de alertas, casos con dictamen, soporte y paneles por rol | Gate de cumplimiento firmado antes de la 15 |
| **15. SPEI y CLABE** | 9 | Las tres | El peso sale y entra, se concilia y se explica, incluido el cobro | Como el plan vigente, más conciliación a tres bandas y cobro conciliado |
| **16. Tarjeta Visa** | 10 | Las tres | La autorización aplica la regla contra el saldo | Como el plan vigente, más operación de tarjetas |

SPEI y Visa siguen al final, como decidió el fundador. La tarea encolada «Fase 4 del expediente y la bandeja» pasa a ser la **fase 7** y no empieza hasta que cierre la 6.

**Por qué este orden.** Las fases 4 a 6 corrigen la base y las puertas antes de construir encima. Las 7 a 9 completan el circuito tipo Ramp (tarjeta, comprobante, aprobación y póliza) sobre la base nueva, con datos de muestra. La 10 pone la mitad regulatoria de la SOFIPO antes de preparar cualquier pago. Las 11 a 13 completan los flujos del cliente, ya con esas reglas: lo que sale a proveedores, lo que sale a nómina y lo que entra por cobranza. La 14 deja encendidas las alertas y los casos antes de que exista una operación real, ya sabiendo quién se espera que pague y a quién. Las 15 y 16 conectan el dinero y la operación de la SOFIPO sobre él. Cada fase deja funcionando algo en una superficie: el portal SOFIPO gana clientes en la 5, el KYB en la 10, alertas en la 5 y en la 14, y operación en la 15 y la 16.

### Fase 4 — Base multi-cliente

**Por qué aquí.** Es el cambio que toca todos los repositorios. Hecho ahora toca siete. Hecho después tocaría también las pantallas de las fases 7 a 9.

**Entregable.** Producción muestra las mismas pantallas del cliente que hoy, pero sobre la base nueva. Una persona puede pertenecer a dos empresas y tener varios roles en una. Nadie crea una empresa desde la portada. Las personas entran por invitación y fijan su propia contraseña. Cada PR corre la suite completa y la matriz de aislamiento en CI.

**Se construye.**

- **CI:** un comando de pruebas único, ejecutado en cada PR contra una rama efímera de Neon con todas las migraciones. Incluye las cuatro pruebas de Postgres que hoy no corren solas, una prueba de deriva (el esquema vivo coincide con el repositorio) y una regla de protección de `main` que bloquea la mezcla si algo falla.
- **Tenencia** de la sección 3.2, con la migración de lo que hay en producción.
- **Contexto de tenencia** por petición y repositorios que lo reciben. Se borran las deducciones de empresa a partir del usuario.
- **Matriz única de capacidades** y roles del cliente combinables.
- **El pool, los errores de dominio y su traducción** salen del módulo de sesión a un módulo del núcleo. Los errores se reconocen por código estable, no por la frase del trigger.
- **Roles de base de datos y RLS** de la sección 3.5, en todas las tablas de negocio.
- **Auditoría nueva** de la sección 3.6, con la función única, el sellado y los eventos que hoy faltan.
- **Puerta cerrada:** se quita el alta pública y el alta que inicia sesión. Hasta la fase 5, la empresa se crea con un comando del personal, auditado. Llegan la invitación con enlace de un solo uso, la contraseña propia, la verificación de correo y la recuperación, y se suman el límite de intentos y los encabezados de seguridad. Los correos salen por Resend, con el remitente que entregue el fundador (decisión 4).
- **Limpieza:** se quitan los stubs, se unifican las dos carpetas de dominio, la tabla de prueba de firmas sale del esquema de producción y se actualiza el README.

**Queda fuera.** Dominios separados, portal SOFIPO, segundo factor y cambios visuales.

**Listo cuando.**

- CI corre en cada PR, bloquea la mezcla si falla, y la suite completa pasa ahí, incluidas las pruebas de Postgres.
- Una persona con membresía en dos empresas ve solo la empresa elegida, y cambiar de empresa no mezcla datos.
- En una prueba que quita a propósito el filtro de la aplicación, Postgres no devuelve filas de otra empresa.
- Ninguna ruta pública crea una empresa, y el alta ya no inicia sesión.
- Ninguna contraseña la conoce otra persona. La invitación caduca y sirve una sola vez.
- La invitación llega desde el remitente verificado y no cae en spam en las bandejas de prueba.
- Asignar roles, cargar la 69-B, entrar, salir y fallar dejan evento en la bitácora nueva. Un `SAVEPOINT` ya no rompe la regla de la misma transacción.
- Las empresas que hoy están en producción siguen intactas después de migrar.

**Validación como cliente.** Una administradora invita a un liberador. Él recibe el correo, fija su contraseña y entra. Una contadora con dos empresas elige una y después la otra. Un intento de alta desde la portada no crea nada.

### Fase 5 — Tres superficies y portal SOFIPO mínimo

**Por qué aquí.** Con la base lista, se separan las puertas. Hoy la SOFIPO opera desde la consola del cliente y el cliente toca datos de plataforma. Sin este portal, el segundo cliente se origina con un comando.

**Entregable.** Tres dominios. En `operacion.<dominio>`, el personal de la SOFIPO entra con segundo factor y puede: dar de alta un prospecto, activarlo con la aprobación de una segunda persona, invitar al primer administrador del cliente, asignar plan y suscripción, suspender o congelar a un cliente en un solo acto, administrar la lista 69-B, administrar personal y roles con doble firma, consultar la bitácora y ver un panel de alertas operativas. El portal del cliente pierde «Alta», «Precios», la publicación del precio, la aceptación de la suscripción y el botón de la 69-B. El teléfono tiene su propia entrada.

**Se construye.**

- Dominios, guardia central de rutas y una cookie por superficie. Sesiones múltiples, con nivel de autenticación y cierre remoto.
- Segundo factor (TOTP o passkey) obligatorio para el personal de la SOFIPO, el administrador y el liberador, más la re-autenticación antes de actos sensibles.
- El proyecto de Vercel de la SOFIPO, con firewall y sus propias variables.
- **Portal SOFIPO, primer corte:**
  - **Clientes:** lista, ficha y ciclo de vida. El recorrido de 30 días lo abre la SOFIPO como empresa de demostración, no un formulario público.
  - **Panel de alertas operativas,** por rol, con dueño y antigüedad: aprobaciones esperando segunda firma, invitaciones vencidas, correos rebotados, clientes congelados, copia de la 69-B vieja o ausente y entradas fallidas repetidas. Es el mismo panel que las fases 10 y 14 llenan con alertas de listas y de PLD, así que nace con prioridades P0 a P3 desde ahora.
  - **Aprobaciones de plataforma:** la lógica de dos personas que hoy existe para las firmas del cliente, generalizada a activación, suspensión, precio y accesos.
  - **Planes y suscripción por cliente**, con versiones de precio y vigencia. La cifra sigue sin publicarse, y publicarla pide dos firmas.
  - **Lista 69-B:** carga manual del personal más un trabajo programado que la refresca. Cada carga deja evento con la fecha del archivo. El cliente solo la lee.
  - **Personal y roles,** con la segregación de 3.3.
  - **Bitácora** filtrable. Abrir datos de un cliente pide motivo.
  - **Congelar cliente:** en un solo acto deja a la empresa sin acciones, y sus usuarios ven un texto neutro («cuenta en revisión»). Es la base de la suspensión inmediata que la Lista de Personas Bloqueadas exigirá en la fase 10.
- **Teléfono:** entrada por enlace de un solo uso, sesión ligada al dispositivo y cierre de sesiones el día de la baja.

**Queda fuera.** KYB, riesgo y alertas de PLD. Ningún módulo sin trabajo entra al menú.

**Listo cuando.**

- Una sesión de un dominio no abre otro, probado en las seis direcciones.
- Una ruta sin superficie y capacidad declaradas no se construye.
- Nadie del personal de la SOFIPO, ningún administrador y ningún liberador entra sin segundo factor.
- Una sola persona no puede activar un cliente ni darse un rol a sí misma. La base lo rechaza.
- Ningún usuario del cliente puede escribir la 69-B ni el precio.
- El personal de la SOFIPO no tiene ninguna capacidad de liberar, aprobar o firmar por un cliente, probado contra los permisos de la base.
- Cada lectura del personal sobre una empresa deja evento con motivo.
- Un cliente congelado no ejecuta ninguna acción, y el texto que ve no menciona la causa.
- Cada alerta del panel tiene dueño y no desaparece sin un cierre con motivo.

**Validación como cliente.** Doble: como personal de la SOFIPO (originación y segunda firma) y como el administrador del cliente que recibe la invitación.

### Fase 6 — Portal del cliente y teléfono

**Por qué aquí.** Es lo que el comprador ve en la primera demo. Además, las pantallas de las fases 7 a 13 tienen que nacer con el sistema visual nuevo y no rehacerse después.

**Entregable.** La administradora entra y abre en **Pendientes**, con la lista de arranque de su empresa. El tarjetahabiente entra desde su teléfono y ve su nombre, su empresa, sus topes por categoría y los datos de facturación de la empresa a un toque. Puede instalar el acceso en su pantalla de inicio. Nunca ve cajones, proveedores ni la política completa.

**Se construye.**

- Ruteo por rol al entrar. Una persona con rol de consola y con tarjeta tiene las dos superficies, cada una en su dominio.
- Portada «Pendientes» por rol y lista de arranque. Un solo indicador de conexiones (emisor y participante) reemplaza los descargos repetidos. El plan y la suscripción pasan a «Configuración → Plan», en solo lectura.
- Bitácora de la empresa (sin eventos confidenciales) y sesiones activas, visibles para el administrador.
- El administrador ve la póliza en solo lectura.
- Aviso de CLABE repetida entre personas, y entre una persona y un proveedor.
- Una sola forma de escribir la hora en las tres superficies. Selector de fecha con calendario y carga de archivos con arrastrar y soltar.
- **Pase de diseño:** tipografía de producto con cifras tabulares, mono solo para RFC, CLABE y UUID. Tablas con búsqueda, filtros, orden y panel lateral, empezando por Personas y Proveedores. Chips del vocabulario único de estados y avisos que confirman. Co-marca con el logo del cliente si el fundador la decide.
- **Teléfono como app:** barra inferior solo con las secciones que ya tienen trabajo, manifest, datos de facturación con QR y topes marcados como «tope de la política».

**Queda fuera.** Tarjetas, gastos, comprobantes, cobranza y avisos por WhatsApp.

**Listo cuando.**

- El tarjetahabiente nunca aterriza en el portal del cliente. Si fuerza una ruta, no recibe ningún dato de la empresa.
- La portada no muestra «cifra no publicada» ni descargos repetidos, y cada pendiente lleva a su acción.
- Con 200 personas y 200 proveedores de prueba, las tablas buscan y filtran. Desde 1024 px, el primer pantallazo trae la lista y la acción principal.
- Una CLABE repetida avisa antes de guardarse.
- La hora se escribe igual en todas partes.
- Sin sesión, el teléfono no muestra nada de la empresa.

**Validación como cliente.** Como administradora en su primer día, como liberador y como tarjetahabiente a 390 px.

### Fase 7 — Expediente del gasto, aprobaciones y bandeja (antes fase 4)

**Entregable y alcance:** los del plan vigente. Se suma:

- **Correo transaccional de avisos** por Resend: aprobación pendiente y comprobante por vencer. El enlace del aviso lleva a la pantalla y exige sesión. No aprueba por sí solo.
- **Export de póliza de muestra** en formatos que importen CONTPAQi y Aspel COI, además de Excel.
- **Catálogo de cuentas** de la empresa y su mapeo de categoría a cuenta.
- **Cadena de aprobación legible** con el jefe y el centro de costo del maestro, delegación por ausencia y aviso de lo que lleva días esperando.
- El solicitante recibe su pantalla.

**Listo cuando:** el criterio del plan vigente, más: un contador real importa la póliza de muestra en CONTPAQi o en Aspel COI sin editarla, y el aviso llega a la persona correcta.

### Fase 8 — Comprobantes CFDI (antes fase 5)

**Entregable y alcance:** los del plan vigente. Se suma un **buzón de facturas por empresa** (una dirección que recibe XML y los pasa por el mismo parser) y la **detección de duplicados**: el mismo UUID o el mismo ticket dos veces. El buzón usa la recepción de correo de Resend, en una dirección por empresa bajo el dominio del remitente. El parser lee también el XML de ingreso que emite la propia empresa, porque la fase 13 lo usa para cobrar.

**Listo cuando:** el criterio del plan vigente, más: un UUID que ya está en otro expediente no se cuelga dos veces, y un XML que llega al buzón termina en el mismo estado que uno subido a mano.

### Fase 9 — App del tarjetahabiente (antes fase 6)

**Entregable y alcance:** los del plan vigente, con las tarjetas en borrador. Se suma:

- **Solicitud de tarjeta y de aumento** desde el teléfono, aprobada por el jefe del maestro.
- **Aprobar desde el teléfono** si la persona es jefe.
- **Canal de WhatsApp** cuando exista el proveedor (decisión 5). Si no existe, la app sigue siendo el camino.

Como la tarjeta es recargable, cada tarjeta en borrador ya registra su fuente de fondos: la cuenta de la empresa.

**Antes de empezar:** el oficial dice si el tarjetahabiente es «tercero autorizado» y qué expediente necesita (sección 6). Si necesita expediente completo, el alta del tarjetahabiente pide los datos desde aquí, aunque la verificación llegue en la fase 10.

**Listo cuando:** el criterio del plan vigente, más: una solicitud de aumento llega al jefe correcto y el aumento no supera la política de la empresa.

### Fase 10 — Originación del cliente (KYB), listas y riesgo

**Por qué aquí.** Es la mitad regulatoria de la SOFIPO y tiene que existir antes de preparar dinero. Con ella, la liberación de la fase 11 nace sabiendo si el cliente está aprobado, si el beneficiario pasó las listas y si el monto cabe en la envolvente.

**Entregable.** La SOFIPO integra el expediente de una empresa, la filtra contra listas, calcula su grado de riesgo, fija su envolvente y la activa con la aprobación de una persona distinta. La empresa sube sus documentos desde su portal y solo ve el estado («en revisión», «aprobada», «falta un documento»), nunca la causa interna.

**Se construye.** Requisitos detallados en el [portal de la SOFIPO, secciones 4 y 6](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/portal-sofipo.md):

- **Expediente del cliente:** documentos con estado propio, versiones, vigencias, semáforo y fecha de la siguiente revisión. Propietarios reales para PLD y beneficiario controlador fiscal, con los dos resultados guardados. Apoderados, entrevista y perfil transaccional inicial, que incluye lo que la empresa espera pagar y lo que espera cobrar.
- **Expediente del tarjetahabiente,** con el alcance que dictamine el oficial, y la identificación no presencial con la tecnología que apruebe el responsable de riesgos. Requiere un proveedor de verificación de identidad (decisión 5).
- **Filtro contra listas:** Lista de Personas Bloqueadas, ONU, PEP, jurisdicciones de riesgo, 69-B y OFAC, al dar de alta y en cada carga nueva de una lista. Una coincidencia abre un caso visible solo para cumplimiento. Una coincidencia confirmada en la Lista de Personas Bloqueadas congela a la empresa en un acto (la primitiva de la fase 5) y entra al panel de alertas como P0.
- **Matriz de riesgo** versionada, con el puntaje desglosado por factor y recalculada ante eventos. El alto riesgo exige además al directivo facultado.
- **Envolvente por cliente:** tope mensual de tarjeta, tope diario de SPEI, número de tarjetas, giros bloqueados, uso internacional y efectivo. Subirla pide dos personas, bajarla pide una. La política de la empresa no puede superar la envolvente, y la base lo rechaza.
- **La activación exige el expediente aprobado.** Reemplaza la activación manual de la fase 5. Las empresas de demostración siguen sin poder activarse.
- **Exportación del expediente** con índice, para auditoría.

**Queda fuera.** Monitoreo transaccional y casos completos con Comité.

**Antes de empezar:** las respuestas del oficial marcadas para esta fase en la sección 6.

**Listo cuando.**

- Ningún cliente se activa sin un expediente aprobado por una persona distinta de quien lo integró. Si es de alto riesgo, también por el directivo.
- Una coincidencia en la Lista de Personas Bloqueadas bloquea el alta, congela en un acto y aparece como P0 solo en el panel de cumplimiento.
- Soporte, operación y el cliente no ven la causa.
- Un documento vencido aparece en el semáforo y en la cola de revisiones.
- La empresa no puede escribir un tope mayor que su envolvente.
- Cada cliente guarda la versión de la matriz con la que se le calificó.

**Validación como cliente.** Como originación y cumplimiento de la SOFIPO, y como la empresa que sube sus documentos.

### Fase 11 — Liberación de proveedores y layout (antes fase 7)

**Entregable y alcance:** los del plan vigente. Se suma:

- El botón apagado también explica: cliente sin expediente aprobado, beneficiario sin filtrar contra listas, monto fuera de la envolvente o cliente congelado.
- **Lote de pagos a varios proveedores** en una sola liberación.
- **Alta del proveedor por liga:** el proveedor captura su RFC, su CLABE y su constancia, y finanzas aprueba.
- **Aviso por correo del cambio de CLABE** de un proveedor, como alerta antifraude.
- Cuenta contable por defecto en la ficha del proveedor.

**Listo cuando:** el criterio del plan vigente, más: un pago por encima de la envolvente no llega a «listo para liberar», y un cambio de CLABE seguido de un pago queda marcado (se convierte en alerta en la fase 14).

### Fase 12 — Dispersión de nómina (antes fase 8)

**Entregable y alcance:** los del plan vigente. Se suma la **importación del lote** desde el archivo que ya genera el sistema de nómina, el aviso de CLABE repetida dentro del lote, y **reportes y presupuestos** por centro de costo, persona, proveedor y categoría, con descarga. Los reportes van aquí porque desde esta fase existen los tres flujos de salida modelados (tarjeta, proveedores y nómina), y el reporte se construye una vez sobre todos. La cobranza de la fase 13 se suma a esos reportes como flujo de entrada.

**Listo cuando:** el criterio del plan vigente, más: un archivo importado con una CLABE de dígito malo no crea esa línea y dice cuál fue.

### Fase 13 — Cobranza (cuentas por cobrar)

**Por qué aquí.** El fundador decidió que cada portal de cliente cobra, además de pagar a proveedores, dispersar nómina y gastar con tarjeta. Va después de la nómina porque reutiliza lo que ya existe: el parser del CFDI (fase 8), la póliza y el catálogo de cuentas (fase 7), el correo y las tablas con panel lateral (fases 4 y 6). Va antes de las alertas porque el registro de deudores le dice al motor de la fase 14 quién se espera que deposite. Y va antes de SPEI porque así la fase 15 conecta en una sola vez lo que sale y lo que entra.

**Entregable.** La persona de cobranza de una empresa ve qué le deben, quién, desde cuándo y qué vence esta semana. Las facturas por cobrar nacen del XML de ingreso que la empresa ya timbró en su propio sistema. Registra cobros totales o parciales, manda recordatorios por correo y ve la antigüedad de saldos. El contador recibe los cobros en la póliza de muestra. Todavía no entra ningún peso por la plataforma.

**Se construye.**

- **Deudores** (los clientes de la empresa): RFC normalizado, porque manda el RFC, igual que en proveedores. Razón social, régimen, código postal, contacto de cobranza con correo, días de crédito comercial y cuenta contable.
- **Facturas por cobrar** desde el XML de ingreso (tipo I) que emitió la empresa, con el parser de la fase 8, por carga manual o por el buzón. Una factura entra solo si el RFC emisor es el de la empresa. Un UUID no entra dos veces, y se consulta su estado ante el SAT: una factura cancelada no se cobra. Las notas de crédito (tipo E) relacionadas reducen el saldo. El vencimiento es la fecha más los días de crédito, y cambiarlo exige un motivo.
- **Cobros:** registro de un pago total o parcial con fecha, forma de pago y evidencia (comprobante o CEP), aplicado a una o varias facturas. Antes de la fase 15, un cobro registrado a mano queda **«por confirmar»**, separado de lo que la fase 15 confirmará con el abono real.
- **PPD:** si la factura es PPD, cada cobro deja visible «complemento de pago por emitir», con la fecha límite del quinto día natural del mes siguiente. La factura no pasa a «en la póliza» hasta que la empresa sube el complemento tipo P que ella misma timbró. Es el mismo criterio que con proveedores, del otro lado.
- **Antigüedad de saldos** por deudor y por tramos (al corriente, 1 a 30, 31 a 60, 61 a 90 y más de 90 días), y un estado de cuenta por deudor que se puede descargar.
- **Recordatorios por correo** con Resend, antes y después del vencimiento, con el estado de cuenta. Salen del remitente de la plataforma con el nombre de la empresa, y las respuestas llegan al correo de cobranza de la empresa. Nunca sale un recordatorio de una factura pagada, cancelada o en disputa, y se pueden pausar por deudor.
- **Disputa e incobrable:** marcar una factura en disputa detiene sus recordatorios. Darla por incobrable requiere al administrador, re-autenticación y un motivo.
- **Rol de cobranza** en el portal del cliente, combinable con los demás. El contador ve y exporta. El teléfono no tiene permiso sobre ninguna tabla de cobranza.
- **Póliza:** los cobros entran a la póliza de muestra con la cuenta de clientes, el IVA trasladado cobrado y el UUID.
- **Pendientes:** lo que vence esta semana y los complementos por emitir entran a la portada de la fase 6.

**Queda fuera.** Timbrar facturas o complementos, porque el producto sigue sin ser PAC. Domiciliación o débito directo. Cobro con tarjeta (adquirencia). Factoraje o financiamiento de las cuentas por cobrar, que sería crédito. Cobranza judicial y despachos. La CLABE de cobro, la liga de pago con los datos para transferir y la conciliación automática del abono entran en la fase 15.

**Listo cuando.**

- Un XML de ingreso emitido por la empresa crea su factura por cobrar con vencimiento. Uno emitido por otro RFC no entra, y un UUID repetido o cancelado tampoco.
- Un cobro parcial deja el saldo correcto, y la suma de la antigüedad cuadra con las facturas abiertas.
- El cobro de una factura PPD deja visible el complemento por emitir con su fecha, y la factura no llega a «en la póliza» sin él.
- Un cobro registrado a mano dice «por confirmar» y nunca se presenta como recibido por SPEI.
- No sale un recordatorio de una factura pagada, cancelada o en disputa, ni a un deudor pausado. La respuesta llega al correo de la empresa.
- El tarjetahabiente no ve nada de cobranza, probado contra los permisos de la base.
- La póliza de muestra trae los cobros con su UUID.

**Validación como cliente.** Como la persona de cobranza de una empresa con 50 facturas de prueba (vencidas, parciales y PPD), y como su contador.

### Fase 14 — Alertas, casos y soporte

**Por qué aquí.** Las alertas y los casos tienen que estar encendidos antes de la primera operación real, no después. Va inmediatamente antes de SPEI.

**Entregable.** Cumplimiento recibe alertas con dueño y antigüedad, las analiza, las escala y las cierra con un dictamen. Soporte atiende tickets sin ver que existe un caso. Cada rol de la SOFIPO abre en su panel.

**Se construye.** Requisitos detallados en el [portal de la SOFIPO, secciones 5.3 a 5.5, 7.4 y 10](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/portal-sofipo.md):

- **Motor de escenarios** versionado, con parámetros que cambian con doble firma. Se encienden ya los que no dependen de rieles: proveedor nuevo o en la 69-B, cambio de CLABE seguido de un pago, fraccionamiento sobre pagos preparados, tarjetas nuevas fuera de la nómina declarada, tarjetahabiente que también es beneficiario, empresas conectadas y conducta interna. Los de SPEI y tarjeta quedan definidos y se encienden en las fases 15 y 16. El registro de deudores de la fase 13 define quién se espera que pague a cada empresa, para que el escenario de fondeo de terceros no marque como sospechosos a sus clientes legítimos y sí marque a quien no está registrado.
- **Casos:** alerta, primer nivel, oficial y Comité (fecha, asistentes y sentido), y cierre con dictamen y motivo. Las acciones del caso son reclasificar el riesgo, pedir que se actualice el expediente, limitar la envolvente o congelar al cliente.
- **Canal confidencial** para que el personal reporte. **Bandeja de oficios** y aseguramientos, que congelan con la primitiva de la fase 5.
- **Cola de retenciones de cumplimiento,** que se enciende con SPEI en la fase 15.
- **Soporte:** tickets, identificación de quien llama, plantillas aprobadas, datos enmascarados y registro de aclaraciones.
- **Paneles por rol** completos, sobre el panel de alertas de la fase 5.
- **Revisión trimestral de accesos** firmada y acceso de emergencia con caducidad.

**Listo cuando.**

- Un escenario genera un caso con dueño.
- Un analista no cierra solo una alerta de alta severidad.
- Soporte y el cliente no ven que existe un caso.
- Un dictamen cerrado no se edita.
- Un parámetro de escenario no cambia con una sola firma.
- Cada panel muestra solo lo de su rol.

**Gate antes de la fase 15.** El oficial firma la evaluación de riesgos del producto, previa al lanzamiento, y el Manual con los escenarios y sus umbrales. Sin eso, la fase 15 no empieza aunque esta fase esté cerrada.

### Fase 15 — SPEI y CLABE (antes fase 9)

**Entregable y alcance:** los del plan vigente, con cuatro cambios porque la tarjeta es recargable, la SOFIPO es la dueña de la cuenta y el cliente también cobra:

- **El saldo de la empresa es una cuenta en el libro de la SOFIPO,** conciliada contra el participante, no una cifra que se consulta a un tercero. El libro pasa a ser el registro de la captación. Los cajones siguen siendo asientos sobre esa cuenta. La forma exacta depende de cómo entra la SOFIPO al SPEI (decisión 1).
- **Servicio de rieles** (sección 3.7), con las credenciales solo ahí y los avisos firmados.
- **Cobranza real.** La cuenta de la empresa recibe los cobros con una referencia por factura o por deudor. Si el esquema de la decisión 1 lo permite, cada deudor tiene su propia CLABE de cobro. Un abono que trae su referencia se aplica solo a su factura, guarda su CEP y confirma o corrige el cobro «por confirmar» de la fase 13. Un abono sin referencia queda «por identificar» con una factura sugerida, y no se aplica solo. La liga del estado de cuenta muestra la CLABE y la referencia para pagar.
- **En el portal SOFIPO:**
  - conciliación diaria a tres bandas (libro, estado de cuenta del participante y confirmaciones con CEP), con diferencias como excepción con dueño;
  - devoluciones, como emisora y como receptora;
  - cola de retenciones de cumplimiento;
  - escenarios de SPEI encendidos, incluido el pago de terceros que no son deudores registrados;
  - alertas de operación en el panel: diferencias de conciliación, devueltos sin decisión, envíos sin CEP y abonos por identificar con antigüedad.

**Listo cuando:** el criterio del plan vigente, más:

- La conciliación del día cuadra o muestra la diferencia con dueño.
- Un envío retenido por cumplimiento no sale.
- Un abono con la referencia correcta liquida su factura sin captura, y uno sin referencia no se aplica solo.
- Ninguna credencial de dinero existe en el proyecto del cliente.

### Fase 16 — Tarjeta Visa (antes fase 10)

**Entregable y alcance:** los del plan vigente, con lo que exige la tarjeta recargable:

- **La autorización se decide contra el saldo disponible de la cuenta, la envolvente y la política.** Si el procesador delega esa respuesta al libro de la SOFIPO, el servicio de rieles contesta dentro del tiempo que fija el procesador, con alta disponibilidad. Ese requisito de latencia se valida con el procesador antes de abrir la fase (decisión 2).
- **En el portal SOFIPO:** operación de tarjetas (bloqueo por soporte, reposición y renovación), aclaraciones y contracargos como procesos separados con sus dos relojes, escenarios de tarjeta encendidos y alertas de fraude activo y de caída del emisor en el panel.
- **En el teléfono:** ver la tarjeta virtual con re-autenticación del dispositivo, y congelarla.

**Listo cuando:** el criterio del plan vigente, más: un cargo sin saldo suficiente se niega en la autorización, un bloqueo de soporte llega al emisor con la hora de su confirmación, y una aclaración abre su reloj de 45 días separado del de la marca.

### Después de la fase 16

Inicio de sesión con Google o Microsoft para clientes, roles propios del cliente, apoyo a la DIOT, y API con webhooks. El ERP en vivo sigue fuera, como dice el modelo.

### Cierre de calidad, igual en todas las fases

El orden es fijo y es el del plan vigente. Se agregan condiciones de entrada que corrigen lo que pasó en las fases 2 y 3.

**Para entrar al cierre:**

- CI está en verde, con la matriz de aislamiento.
- Las migraciones están aplicadas en las ramas `main` y `preview` de Neon.
- Las variables de cada proyecto de Vercel están completas.
- El trabajo está desplegado en una URL que el validador puede abrir.

**El cierre:**

1. **Cinco reviews granulares** en paralelo, con las mismas cinco caras en todas las fases:
   - datos, migraciones y RLS;
   - identidad, sesión y permisos por superficie;
   - reglas de negocio y regulación de la fase;
   - interfaz contra la barra de calidad de la superficie que toca;
   - alcance y fugas: dinero real, secretos, mezcla de superficies y menús vacíos.
2. **Correcciones,** solo de esos hallazgos.
3. **Validación como cliente** en la URL desplegada, sin leer el código primero. En las fases del portal SOFIPO, «cliente» es el personal de la SOFIPO, porque la SOFIPO es la clienta de este producto. Cada fase de arriba dice quién valida.
4. **Review de Opus 5.5** (`claude-opus-5-5-high`) sobre el código corregido y el informe de validación. Decide si la fase cierra.

La fase siguiente no empieza mientras Opus deje abierta la anterior, ni antes de que la anterior esté en `main` y en producción.

---

## 5. Decisiones abiertas para el fundador

Ya están decididos la tarjeta recargable, el operador único, la cobranza en el portal del cliente y Resend como proveedor de correo. Cada decisión que queda dice qué fase bloquea y qué hace el plan mientras tanto, para que ninguna detenga el trabajo antes de tiempo.

| # | Decisión | Bloquea | Mientras tanto |
| --- | --- | --- | --- |
| 1 | **Cómo entra la SOFIPO al SPEI:** participante directo, participante indirecto o cliente de un participante, y con quién. Incluye si se pueden asignar CLABEs de cobro por deudor | Fase 15 | El plan supone cuenta de captación en el libro de la SOFIPO, conciliada contra el participante, y cobro por referencia |
| 2 | **Cómo emite la tarjeta:** la SOFIPO como emisora con un procesador, o con un emisor patrocinador. Quién es el procesador y si delega la autorización | Fase 16 | El puerto del emisor sigue desconectado |
| 3 | **Identidad del personal de la SOFIPO:** SSO corporativo (con cuál proveedor) o contraseña con segundo factor, y si opera desde IP fijas | Fase 5 | Contraseña con segundo factor y firewall sin lista de IP |
| 4 | **Remitente de correo, marca y dominio:** la dirección de envío de Resend y su dominio, el nombre del producto, los dominios de los tres portales y si el cliente ve su logo | Fase 4 (el remitente, para las invitaciones) y fase 5 (los tres dominios) | Sin remitente verificado no sale la invitación, y la fase 4 no cierra. Los portales usan dominios provisionales de Vercel, sin co-marca |
| 5 | **Proveedores que faltan:** WhatsApp (fase 9) y verificación de identidad (fase 10) | La fase indicada | Sin proveedor no se enciende el canal. La app sigue siendo el camino del comprobante |

---

## 6. Lo que debe validar el oficial de cumplimiento

Las preguntas del [portal de la SOFIPO, sección 11](/cursor/stores/bc-8ed50dcd-88fe-43ea-80c7-782d3cbdc5ed/docs/portal-sofipo.md) que afectan la funcionalidad siguen vigentes, y no se repiten aquí. Este plan agrega las que nacen de su arquitectura y ordena todas por la fase que bloquean.

**Nuevas, que nacen de este plan:**

| Qué validar | Por qué | Antes de la fase |
| --- | --- | --- |
| Requisitos de autenticación para operaciones por medios electrónicos: factores, duración e inactividad de sesión en las tres superficies | El segundo factor y la política de sesión se construyen en la fase 5 y no deben rehacerse | 5 |
| Los roles internos y las reglas de segregación de la sección 3.3, y quién aprueba los accesos | Se imponen en la base desde la fase 5 | 5 |
| Qué puede ver el personal de la SOFIPO de cada cliente, con qué motivo, y si el cliente ve esos accesos | El plan muestra al cliente los accesos de la SOFIPO, salvo los de cumplimiento, para no alertarlo de una investigación | 5 |
| El texto neutro que ve un cliente congelado o en revisión | Es el mismo acto que la Lista de Personas Bloqueadas usará, y ahí sí hay que avisar al cliente | 5 |
| Que la bitácora (sellado por tramos, lectura auditada, retención sin borrado) satisface la integridad y la auditabilidad del sistema automatizado de PLD | La bitácora se construye en la fase 4 | 4 (no bloquea: el plan conserva todo) |
| Si alojar el libro y los expedientes en infraestructura en Estados Unidos (Neon en `aws-us-east-1`, Vercel en `iad1` y el correo en Resend) requiere aviso o autorización por contratación de servicios con terceros o procesamiento en el extranjero, y qué seguridad de la información se exige | Producción ya está ahí. Los datos reales de clientes entran con el KYB | 10, idealmente antes |
| Aviso de privacidad y consentimiento para las tres superficies, en especial el teléfono, que trata datos personales del empleado, y los recordatorios de cobranza, que escriben a terceros | El teléfono recibe identidad en la fase 6, y la cobranza escribe a los clientes de la empresa en la 13 | 6 y 13 |
| Si la lista 69-B puede usarse como criterio de revisión en el alta del cliente | Es buena práctica, no una obligación de PLD | 10 |
| Si recibir en la cuenta de captación los pagos de los clientes de la empresa, con referencia o con CLABE por deudor, pide algo propio: identificar al ordenante o declarar ese flujo en el perfil transaccional | La cobranza convierte a terceros en ordenantes habituales de la cuenta | 15 (el perfil esperado se captura desde la 10) |

**Las del informe del portal SOFIPO, ordenadas por la fase que bloquean:**

| Antes de la fase | Preguntas del informe (sección 11) |
| --- | --- |
| 9 | 2 (si el tarjetahabiente es tercero autorizado y qué expediente necesita) |
| 10 | 6 (consulta de PEP de la UIF), 7 (beneficiario controlador frente a propietario real), 14 (niveles de aprobación de límites), 18 (datos personales en expedientes y biometría) |
| 14 | 16 (escenarios, umbrales y evaluación previa del producto), 17 (comités de riesgos y de auditoría) |
| 15 | 8 (relación con el participante y reparto de obligaciones), 9 (devoluciones como receptora) |
| 16 | 10 (aclaraciones y abono provisional para personas morales) |

Las preguntas 1 y 15 ya no aplican, porque el crédito queda fuera. Las preguntas 3, 4, 5, 11, 12 y 13 son de reportes regulatorios y pasan al trabajo posterior.

**Lo que el oficial firma, no solo responde:** la evaluación de riesgos del producto previa al lanzamiento y el Manual con los escenarios y sus umbrales. Las dos son el gate entre la fase 14 y la 15.

---

## 7. Riesgos del plan

| Riesgo | Cómo se contiene |
| --- | --- |
| La fase 4 toca todos los repositorios a la vez y puede romper lo que ya funciona | La matriz de aislamiento y la suite completa corren en CI antes de cualquier cambio de tenencia. La migración se prueba primero en la rama `preview` de Neon con las empresas que ya existen |
| RLS mal configurada deja pasar datos, o bloquea de más y rompe pantallas | Prueba de CI que falla si una tabla con empresa no tiene política. Prueba de la segunda pared con el filtro de la aplicación quitado a propósito. Ajustes locales a la transacción por el modo de agrupación de Neon |
| El portal SOFIPO crece sin fin porque el informe regulatorio es largo | Cada módulo entra con la fase que le da trabajo (5, 10, 14, 15 y 16), y un módulo sin trabajo no entra al menú. Los reportes a las autoridades quedan fuera de este plan |
| La cobranza crece hacia facturación, timbrado o financiamiento | La fase 13 lee XML ya timbrado y no timbra. Domiciliación, adquirencia y factoraje quedan fuera de forma explícita |
| El remitente de correo no llega a tiempo y frena la fase 4 | Es la única decisión del fundador que bloquea pronto. Se pide ahora, y la verificación del dominio se hace antes de que la fase 4 llegue a su cierre |
| Las respuestas del oficial llegan tarde y detienen la fase 10 o la 14 | Las preguntas se entregan ahora, ordenadas por fase. Las fases 4 a 9 no dependen de ellas, salvo la 5 (autenticación y segregación) y la 9 (tarjetahabiente) |
| Con la tarjeta recargable, la autorización depende del libro en tiempo real | Se valida con el procesador antes de la fase 16 (decisión 2), y el servicio de rieles se diseña para ese tiempo de respuesta |
| Seis cierres de calidad más que en el plan vigente | Es el costo de no construir el circuito tipo Ramp, con cobranza, sobre una base que no aguanta a la SOFIPO. Las condiciones de entrada al cierre evitan repetir cierres que fallan por infraestructura, como en las fases 2 y 3 |

---

**Trabajo posterior, fuera de este plan:** los reportes regulatorios a la CNBV, la UIF, Banxico y la CONDUSEF (reportes de PLD con acuse, series prudenciales, datos para el participante del SPEI, informe de la UNE, registro del contrato y calendario regulatorio), y la confirmación del nivel de operaciones de la SOFIPO, que solo afecta a esos reportes.
