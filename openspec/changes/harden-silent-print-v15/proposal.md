## Why

`silent_print` contiene una escritura SQL interpolada accesible desde un metodo
whitelisted y puede publicar el PDF a todos los usuarios Desk cuando no existe
un `print_user` configurado. Ademas, la integracion POS documentada esta
desactivada y la generacion PDF y el cliente WebSocket conservan implementaciones
anteriores a Frappe/ERPNext v15 que reducen la seguridad y confiabilidad.

El objetivo es mantener la impresion local y remota, pero con autorizacion
explicita, entrega dirigida, generacion PDF nativa de Frappe v15 y comportamiento
predecible ante errores de configuracion o conectividad.

## What Changes

- Reemplazar la escritura SQL directa de la pestana maestra por APIs seguras de
  Frappe, validando el identificador y la identidad del usuario impresor.
- Impedir que una orden o el contenido PDF se publique en el canal general del
  sitio cuando falten `print_user`, `tab_id` u otra configuracion obligatoria.
- Mantener las verificaciones de permiso de impresion del documento antes de
  generar o entregar el PDF.
- Dejar de registrar payloads PDF base64 en la consola del navegador.
- Sustituir la copia local del generador PDF por las APIs nativas de Frappe v15,
  conservando tamano, margenes y ausencia de membrete configurables.
- Honrar el `print_type` solicitado cuando se suministre y usar
  `default_print_type` solamente como fallback documentado.
- Inicializar el WebSocket solo cuando sea necesario, esperar a que este abierto,
  poner en cola entregas transitorias y reconectar con espera incremental acotada.
- Mostrar y permitir la seleccion de pestana maestra solo al usuario configurado
  como receptor de impresion remota.
- Restaurar la impresion silenciosa del POS de ERPNext v15, conservando la
  impresion nativa como fallback para formatos no configurados o fallos
  recuperables.
- Agregar pruebas automatizadas y documentar configuracion, errores y limitaciones.
- **Cambio de comportamiento de seguridad:** `set_master_tab` dejara de aceptar
  llamadas de usuarios distintos al usuario impresor configurado y una
  configuracion incompleta producira un error controlado en vez de un broadcast.

## Scope

Incluye:

- App `silent_print`, modulo `Silent Print Core`.
- DocTypes `Silent Print Format` y `Silent Print Settings`.
- APIs whitelisted de `silent_print.utils.print_format`.
- Hooks `app_include_js` y `page_js`.
- Cliente WebSocket, eventos Frappe Realtime y flujo Point of Sale.
- Pruebas y README de la app.

## Exclusions

- Cambios al codigo core de Frappe o ERPNext.
- Cambios al software Webapp Hardware Bridge o a sus protocolos.
- Descubrimiento automatico de impresoras, colas persistentes de servidor o
  auditoria historica de trabajos de impresion.
- Soporte para multiples usuarios impresores simultaneos o balanceo entre equipos.
- Ejecucion de migraciones, reinicios, instalacion en sitios o despliegue.

## Capabilities

### New Capabilities

- `secure-print-routing`: autorizacion, configuracion obligatoria y entrega
  Realtime de PDFs exclusivamente al usuario y pestana receptores.
- `frappe-v15-pdf-rendering`: generacion PDF mediante APIs nativas de Frappe v15
  con opciones validadas de pagina y permisos de documento.
- `reliable-hardware-bridge`: gestion confiable del WebSocket local, seleccion de
  impresora, cola transitoria, reintentos y errores visibles.
- `pos-silent-printing`: impresion silenciosa desde Point of Sale en ERPNext v15
  con fallback al flujo nativo.

### Modified Capabilities

No existen especificaciones base previas en `openspec/specs/`.

## Impact

- Archivos principales:
  - `silent_print/utils/print_format.py`
  - `silent_print/public/js/silent_print.js`
  - `silent_print/hooks.py`
  - JSON y controladores de `Silent Print Format` y `Silent Print Settings`
  - pruebas de ambos DocTypes y nuevas pruebas de utilidades
  - `README.md`
- APIs afectadas: `create_pdf`, `print_silently` y `set_master_tab`; puede
  agregarse una API minima que informe al cliente si la sesion actual es el
  receptor configurado sin revelar informacion innecesaria.
- Dependencias: Frappe v15, ERPNext v15, wkhtmltopdf y Webapp Hardware Bridge.
  Se eliminara la dependencia implicita de la app sobre `PyPDF2` y codigo PDF
  copiado.
- Datos: no se planean eliminaciones ni transformaciones destructivas. Cualquier
  ajuste de metadatos de DocType requerira revisar registros existentes antes de
  autorizar `bench migrate`.
- Riesgo: **alto**, porque el cambio protege contenido documental y modifica el
  enrutamiento de trabajos hacia impresoras fisicas.

## Expected Impact

- Los PDFs no abandonan el contexto autorizado aunque falte configuracion.
- Una sesion no autorizada no puede cambiar la pestana receptora.
- La seleccion de impresora coincide con la solicitud documentada.
- La desconexion temporal del bridge no produce bucles de reconexion ni errores
  de envio por socket aun no abierto.
- POS conserva el flujo normal si la impresion silenciosa no aplica.

## Acceptance Criteria

- Ningun camino de `print_silently` llama a `publish_realtime` sin un usuario
  receptor valido y una pestana maestra valida.
- `set_master_tab` rechaza usuarios no autorizados e identificadores invalidos y
  no contiene SQL interpolado.
- La generacion PDF usa las APIs soportadas por Frappe v15 y no mantiene una copia
  del modulo PDF core.
- El navegador no registra el PDF base64 ni abre conexiones al bridge para
  usuarios que no deben recibir impresion remota.
- Los envios esperan `WebSocket.OPEN`, tienen reintentos acotados y notifican el
  fallo final sin duplicar trabajos.
- El argumento `print_type` tiene precedencia documentada sobre el valor por
  defecto.
- El POS imprime silenciosamente solo cuando existe una configuracion aplicable;
  en otro caso ejecuta la impresion nativa.
- Existen pruebas para permisos, configuracion ausente, aislamiento Realtime,
  opciones PDF, seleccion de impresora y estados principales del bridge.
- README, OpenSpec y tareas reflejan el comportamiento finalmente implementado.
