## Context

La app ejecuta codigo cliente en Desk mediante `app_include_js` y vuelve a
referenciar el mismo archivo desde `page_js` para Point of Sale. El cliente abre
un WebSocket a Webapp Hardware Bridge (HWB) en `127.0.0.1:12212`, mientras el
backend genera PDFs y, para impresion remota, los publica en Frappe Realtime.

El analisis sobre Frappe y ERPNext 15.109.0 identifico:

- SQL interpolado y ausencia de autorizacion en `set_master_tab`.
- Broadcast al canal general cuando `print_user` esta vacio.
- Payload PDF base64 escrito en consola.
- Un `tab_id` global modificable por cualquier usuario autenticado.
- Copia local antigua de `frappe.utils.pdf`, sin las correcciones actuales de
  limpieza, cookies e imagenes privadas.
- Reconexiones WebSocket inmediatas y envios antes de `WebSocket.OPEN`.
- `print_type` ignorado e integracion POS comentada.
- Pruebas existentes vacias.

No existe Graphify preparado para esta app; el diseno se basa en la revision
directa de hooks, DocTypes, Python, JavaScript y APIs locales de Frappe/ERPNext
v15. No se modificaran las apps core.

La inspeccion del protocolo oficial confirmo que HWB 0.13.0 devuelve
`status`, `id` y `message` despues de entregar el trabajo al subsistema de
impresion de Windows, mientras que HWB 1.0.1 devuelve `success`, `id`,
`message` y `printer`. Ambas versiones aceptan un identificador por trabajo y
contenido PDF o RAW. El cliente normalizara los dos contratos sin presentar el
acuse como confirmacion fisica de salida de papel.

Interesados:

- Usuarios que solicitan impresiones locales o remotas.
- Usuario impresor que mantiene abierta la sesion conectada al hardware.
- Administradores que configuran formatos, impresora por defecto y usuario
  receptor.
- Operacion/soporte responsable del bridge, navegador y despliegue Frappe.

## Goals / Non-Goals

**Goals:**

- Aislar cada PDF al usuario impresor configurado y evitar broadcasts por
  configuracion incompleta.
- Autorizar y validar el registro de la pestana maestra sin SQL directo.
- Conservar permisos de impresion de Frappe para el documento origen.
- Reutilizar la generacion PDF soportada por Frappe v15.
- Hacer predecibles la conexion, cola, reintento y error del WebSocket.
- Restaurar POS para ERPNext v15 con fallback nativo.
- Mantener compatibles las APIs publicas actuales cuando no contradigan las
  correcciones de seguridad.

**Non-Goals:**

- Modificar HWB, su puerto o su protocolo.
- Crear una cola durable, historial de trabajos o confirmacion transaccional de
  impresion.
- Soportar varios usuarios impresores simultaneos.
- Agregar descubrimiento de impresoras o administrar drivers.
- Cambiar Frappe/ERPNext core o desplegar directamente en produccion.

## Decisions

### 1. Autorizacion del usuario impresor

`set_master_tab` MUST obtener `print_user` desde `Silent Print Settings` y
compararlo con `frappe.session.user`. Una configuracion vacia o una sesion
distinta se rechazara con `frappe.PermissionError`; no se aceptara `Guest`.

El `tab_id` se validara como identificador opaco de longitud acotada generado con
`crypto.randomUUID()` cuando este disponible. Se escribira mediante
`frappe.db.set_single_value`, nunca concatenando SQL. El evento
`update_master_tab` se dirigira solo al `print_user`.

Se conserva el campo actual `tab_id` para minimizar cambios de datos. Al cambiar
`print_user`, el controlador de `Silent Print Settings` limpiara el identificador
anterior para exigir una nueva seleccion explicita.

Alternativa descartada: almacenar la pestana en Redis con TTL. Reduciria
escrituras en base de datos, pero introduce expiracion, recuperacion y
configuracion adicionales que no son necesarias para el modelo actual de un
unico usuario impresor.

### 2. Enrutamiento Realtime cerrado por defecto

`print_silently` validara antes de generar el PDF:

1. `print_user` no vacio, existente y habilitado.
2. `tab_id` valido y no vacio.
3. existencia de la configuracion `Silent Print Format`.
4. permiso de impresion del solicitante sobre el documento.
5. existencia de un tipo de impresora efectivo.

Solo despues publicara `print-silently` con `user=print_user`. Nunca llamara a
`publish_realtime` con receptor vacio. Todas las pestañas del mismo usuario
pueden recibir su sala Realtime; solamente la que coincida con `tab_id` enviara
el trabajo a HWB. Las demas descartaran el evento sin registrar el PDF.

El payload incorporara un `job_id` opaco para diagnostico y proteccion local
contra procesamiento duplicado, sin convertirse en una cola persistente.

Alternativa descartada: emitir al canal general y filtrar por JavaScript. Aunque
solo una pestaña imprima, revelaria el documento a usuarios no autorizados.

### 3. Generacion PDF nativa de Frappe v15

`create_pdf` validara primero `Silent Print Format` y construira un diccionario
acotado de `pdf_options`. Usara:

`frappe.get_print(..., as_pdf=True, pdf_options=options)`

Esto mantiene la validacion de permisos y delega cookies, imagenes privadas,
archivos temporales, cifrado y compatibilidad de `wkhtmltopdf` al core soportado.
Se eliminara la copia de `get_pdf`, `prepare_options` y sus imports de `PyPDF2`,
`pdfkit`, `six`, BeautifulSoup y `distutils`.

Para pagina `Custom`, ancho, alto y margenes MUST ser numericos, positivos cuando
aplique y se convertiran explicitamente a unidades `mm`. Para tamanos estandar se
enviara `page-size`. `no_letterhead` se normalizara con utilidades Frappe.

Alternativa descartada: actualizar la copia local del modulo PDF. Continuaria
duplicando codigo de seguridad y aumentaria el costo de cada actualizacion de
Frappe.

### 4. Contrato de seleccion de impresora

El `print_type` explicito tendra precedencia. Si esta vacio, se usara
`Silent Print Format.default_print_type`. Si ambos faltan, el backend devolvera
un error controlado y no emitira ni enviara el PDF.

Esta decision recupera el comportamiento documentado para imprimir un mismo
formato en distintas impresoras. La etiqueta se tratara como dato opaco, con
longitud acotada y sin incorporarla a comandos de sistema o SQL.

### 5. Ciclo de vida WebSocket

`WebSocketPrinter` sera una clase reutilizable que no conecte durante su
definicion. La conexion se iniciara al primer trabajo local o, para recepcion
remota, solo si la API de configuracion confirma que la sesion pertenece al
`print_user`.

Estados minimos: `idle`, `connecting`, `open`, `closed` y `failed`.

- Un envio recibido durante `connecting` se mantendra en una cola en memoria,
  acotada por cantidad.
- La cola se vaciara una sola vez al alcanzar `WebSocket.OPEN`.
- Una desconexion previa al envio reintentara con espera exponencial y maximo
  acotado.
- Un trabajo ya entregado a `websocket.send()` no se reenviara automaticamente,
  porque HWB no ofrece en el contrato actual una confirmacion idempotente.
- Al agotar reintentos se notificara al usuario y se descartara la conexion; el
  trabajo no quedara persistido.
- No se escribiran PDF base64 ni datos del documento en consola.
- Las respuestas 0.13.0 y 1.0.1 se normalizaran a `success`, `job_id`,
  `message` y `printer`; la ausencia de respuesta despues de enviar se tratara
  como resultado ambiguo y no como fallo reintentable automatico.

Alternativa descartada: reconexion inmediata ilimitada. Puede crear un bucle de
CPU/red cuando HWB no esta instalado o el puerto no responde.

### 6. Inicializacion selectiva del cliente remoto

Se agregara una API minima de configuracion de cliente que devuelva al usuario
actual solo:

- si es el receptor configurado;
- si existe una pestana maestra;
- el identificador maestro solo cuando el usuario actual sea el receptor.

El icono de impresora y los listeners remotos se habilitaran exclusivamente para
ese usuario. La clase de impresion local permanecera disponible bajo
`frappe.silent_print` para botones personalizados, sin abrir conexiones por si
sola.

### 7. Integracion POS aislada y reversible

El codigo POS se separara en `public/js/pos_silent_print.js`, cargado por
`page_js`. Una instalacion protegida por bandera se aplicara una sola vez sobre
`erpnext.PointOfSale.PastOrderSummary.prototype.print_receipt` y conservara una
referencia al metodo original.

Al imprimir:

1. intentar generar el PDF solo si el Print Format del POS tiene un
   `Silent Print Format`;
2. enviar a HWB con el tipo por defecto;
3. ejecutar el metodo original si no existe configuracion silenciosa o si el
   bridge falla antes de aceptar el trabajo;
4. no ejecutar fallback automatico despues de `websocket.send()`, porque podria
   duplicar una impresion ya aceptada.

La implementacion se verificara contra la firma real de ERPNext v15 durante el
desarrollo. No se modificara ningun archivo de ERPNext.

### 8. DocTypes y validacion

`Silent Print Format` incorporara validacion de:

- tipo de impresora por defecto no vacio para flujos que dependan de el;
- ancho y alto obligatorios, numericos y positivos cuando `page_size=Custom`;
- margenes numericos y no negativos.

Los campos existentes se conservaran inicialmente para evitar una conversion
destructiva. Puede agregarse `mandatory_depends_on` y propiedades de interfaz.
`tab_id` sera de solo lectura en `Silent Print Settings`.

No se crean DocTypes, fixtures, reportes ni patches. Un cambio de metadata JSON
requerira `bench migrate` posteriormente y solo con autorizacion.

### 9. Pruebas

Las pruebas Python usaran las utilidades de testing de Frappe v15 y mocks para
PDF y Realtime cuando no sea necesario wkhtmltopdf real. Cubriran:

- autorizacion y validacion de `set_master_tab`;
- ausencia de broadcast con configuracion incompleta;
- permisos del documento;
- precedencia de `print_type`;
- opciones PDF estandar y custom;
- limpieza de `tab_id` al cambiar usuario;
- contrato de la API de configuracion cliente.

Las pruebas del navegador cubriran estados de socket, cola, backoff, no
duplicacion y fallback POS. Si la app no dispone de harness JavaScript, se
documentara una prueba manual reproducible y se agregaran pruebas unitarias al
nivel mas cercano disponible sin introducir un framework innecesario.

## Affected Components

- DocTypes: `Silent Print Format`, `Silent Print Settings`.
- Hooks: `app_include_js`, `page_js`.
- APIs: `create_pdf`, `print_silently`, `set_master_tab` y nueva consulta minima
  de configuracion cliente.
- Python: `silent_print/utils/print_format.py` y controladores de DocType.
- JavaScript: `silent_print/public/js/silent_print.js` y nuevo archivo POS.
- Documentacion/pruebas: README y suites de `silent_print`.
- Reportes, fixtures y patches: ninguno previsto.

## Risks / Trade-offs

- [PDF grande supera limites de Socket.IO o memoria] -> medir con documentos
  representativos, limitar cola local y documentar el tamaño operativo probado.
- [HWB no confirma recepcion idempotente] -> no reenviar trabajos despues de
  `websocket.send()` y mostrar estado ambiguo al usuario.
- [Monkey patch POS cambia en otra version ERPNext] -> aislarlo, guardar fallback
  original, probar contra version-15 y fallar de forma segura.
- [Registros existentes carecen de impresora o dimensiones validas] -> auditar
  antes de activar validacion estricta y no transformar datos automaticamente.
- [WebSocket `ws://` bloqueado por politicas del navegador] -> verificar en los
  navegadores y esquema HTTPS reales; no relajar CSP ni seguridad sin un cambio
  separado.
- [Cambio de permisos interrumpe una operacion informal existente] -> documentar
  que solo el usuario impresor puede seleccionar pestaña y ofrecer error claro.

## Migration Plan

1. Confirmar registros actuales de ambos DocTypes sin exponer datos sensibles.
2. Implementar y ejecutar pruebas en la rama dedicada.
3. Validar OpenSpec y revisar diff, dependencias y ausencia de secretos.
4. Probar en un sitio de desarrollo con Frappe/ERPNext v15 y HWB controlado.
5. Probar configuracion incompleta, usuario no autorizado, desconexion y POS.
6. Con autorizacion explicita, ejecutar build de assets y `bench migrate` en
   staging si cambia metadata de DocType.
7. Realizar prueba funcional con impresora de prueba y revisar logs sin payloads.
8. Crear commit, push y Pull Request para revision antes de produccion.

## Rollback

- Revertir los commits de la rama sin eliminar registros ni DocTypes.
- Reconstruir assets para restaurar el JavaScript anterior.
- Si se sincronizo metadata, ejecutar `bench migrate` autorizado con la revision
  revertida.
- Mantener intactos `print_user`, `tab_id` y registros `Silent Print Format`;
  ningun paso del cambio elimina datos.
- Si el problema esta limitado a POS, retirar el hook POS de la revision
  desplegada mientras se conserva el endurecimiento backend.

## Open Questions

- Confirmar la version de HWB y si su protocolo ofrece una respuesta que permita
  distinguir trabajo aceptado de trabajo impreso.
- Medir el tamaño maximo de PDF y tiempo de conexion aceptables en el entorno de
  staging antes de fijar limites de cola y timeout definitivos.
- Verificar navegadores y politicas HTTPS/CSP usados en produccion para confirmar
  acceso permitido a `ws://127.0.0.1:12212`.
