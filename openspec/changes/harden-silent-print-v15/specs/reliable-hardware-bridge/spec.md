## ADDED Requirements

### Requirement: Conexion WebSocket bajo demanda
El cliente MUST abrir el WebSocket de HWB solamente al existir un trabajo local
o cuando la sesion pertenezca al usuario impresor remoto.

#### Scenario: Usuario Desk ordinario
- **WHEN** un usuario que no es `print_user` abre Desk y no solicita impresion local
- **THEN** el navegador no intenta conectar con `127.0.0.1:12212`

#### Scenario: Primer trabajo local
- **WHEN** un usuario solicita una impresion local y el bridge no esta conectado
- **THEN** el cliente inicia una unica conexion y conserva temporalmente el trabajo

#### Scenario: Usuario impresor remoto
- **WHEN** la API de cliente confirma que la sesion es el receptor configurado
- **THEN** el cliente habilita la seleccion de pestana y la recepcion remota

### Requirement: Envio solamente con socket abierto
El cliente MUST llamar a `websocket.send()` solamente cuando el estado sea
`WebSocket.OPEN`.

#### Scenario: Trabajo durante conexion
- **WHEN** llega un trabajo mientras el socket esta en `CONNECTING`
- **THEN** el trabajo permanece en una cola en memoria hasta que el socket abre

#### Scenario: Apertura exitosa
- **WHEN** el socket pasa a `OPEN`
- **THEN** el cliente envia una vez cada trabajo encolado y vacia la cola

#### Scenario: Cola llena
- **WHEN** la cola alcanza su limite configurado
- **THEN** el cliente rechaza nuevos trabajos con un error visible sin consumir memoria sin limite

### Requirement: Reconexion acotada
El cliente MUST aplicar espera incremental y un numero maximo de intentos cuando
HWB no esta disponible.

#### Scenario: Bridge temporalmente caido
- **WHEN** la conexion se cierra antes de entregar trabajos pendientes
- **THEN** el cliente reintenta con backoff hasta el limite definido

#### Scenario: Intentos agotados
- **WHEN** se alcanza el maximo de reintentos sin abrir el socket
- **THEN** el cliente informa el fallo, detiene el bucle y aplica el fallback seguro cuando corresponda

#### Scenario: Trabajo ya enviado
- **WHEN** `websocket.send()` retorno sin error y luego se pierde la conexion
- **THEN** el cliente no reenvia automaticamente ese trabajo

### Requirement: Seleccion determinista de impresora
El sistema MUST usar el `print_type` explicito cuando se proporcione y MUST usar
el valor por defecto del formato solamente cuando el argumento este vacio.

#### Scenario: Impresora explicita
- **WHEN** una orden solicita `print_type=KITCHEN`
- **THEN** el payload enviado a HWB contiene `type=KITCHEN` aunque exista otro valor por defecto

#### Scenario: Impresora por defecto
- **WHEN** la orden no especifica `print_type` y el formato tiene un valor por defecto
- **THEN** el payload usa `default_print_type`

#### Scenario: Impresora no definida
- **WHEN** no existe tipo explicito ni valor por defecto
- **THEN** el sistema rechaza la orden antes del envio y muestra un error util

### Requirement: Trabajo no duplicado por pestaña
El cliente MUST procesar como maximo una vez cada `job_id` en la pestana maestra
y MUST NOT enviarlo desde pestañas no maestras.

#### Scenario: Evento repetido
- **WHEN** la pestana maestra recibe nuevamente un `job_id` ya procesado durante la sesion
- **THEN** el cliente descarta el duplicado

#### Scenario: Dos pestañas del usuario impresor
- **WHEN** ambas reciben el mismo evento Realtime
- **THEN** solamente la que coincide con `tab_id` intenta enviarlo a HWB

### Requirement: Errores visibles y no sensibles
El cliente MUST comunicar conexion fallida, cola llena y configuracion invalida
sin exponer el PDF o secretos.

#### Scenario: Error de conexion
- **WHEN** HWB no responde dentro de los intentos permitidos
- **THEN** el usuario recibe una notificacion accionable que no contiene `file_content`
