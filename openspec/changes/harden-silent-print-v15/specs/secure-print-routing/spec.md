## ADDED Requirements

### Requirement: Configuracion cerrada por defecto
El sistema MUST rechazar una impresion remota antes de generar o publicar el PDF
cuando el usuario impresor o la pestana maestra no esten configurados y validos.

#### Scenario: Usuario impresor ausente
- **WHEN** un usuario solicita impresion remota y `print_user` esta vacio
- **THEN** el sistema devuelve un error controlado y no llama a `publish_realtime`

#### Scenario: Pestana maestra ausente
- **WHEN** existe un usuario impresor pero `tab_id` esta vacio o es invalido
- **THEN** el sistema devuelve un error controlado y no genera ni publica el PDF

#### Scenario: Usuario impresor deshabilitado
- **WHEN** `print_user` referencia un usuario inexistente o deshabilitado
- **THEN** el sistema rechaza la orden sin emitir contenido documental

### Requirement: Registro autorizado de pestana maestra
El sistema MUST permitir registrar la pestana maestra solamente a la sesion del
usuario impresor configurado y MUST persistir el identificador mediante una API
segura de Frappe sin SQL interpolado.

#### Scenario: Registro autorizado
- **WHEN** el usuario de sesion coincide con `print_user` y envia un `tab_id` valido
- **THEN** el sistema guarda el identificador y dirige la actualizacion Realtime solamente a ese usuario

#### Scenario: Registro por otro usuario
- **WHEN** un usuario autenticado distinto a `print_user` llama a `set_master_tab`
- **THEN** el sistema lanza un error de permiso y no modifica `Silent Print Settings`

#### Scenario: Identificador manipulado
- **WHEN** `tab_id` contiene sintaxis SQL, longitud excesiva o caracteres no permitidos
- **THEN** el sistema rechaza el valor sin ejecutar una consulta construida con ese contenido

### Requirement: Permiso sobre el documento
El sistema MUST respetar los permisos de impresion de Frappe para el documento
solicitado y MUST NOT usar `ignore_permissions` para generar el PDF.

#### Scenario: Documento permitido
- **WHEN** el solicitante tiene permiso de impresion sobre el documento
- **THEN** el sistema puede continuar con la generacion y el enrutamiento configurados

#### Scenario: Documento no permitido
- **WHEN** el solicitante no tiene permiso de impresion sobre el documento
- **THEN** el sistema devuelve un error de permiso y no entrega contenido al usuario impresor

### Requirement: Aislamiento del evento de impresion
El sistema MUST publicar cada orden remota solamente en la sala Realtime del
usuario impresor validado y solamente la pestana cuyo identificador coincide
MUST enviarla al bridge.

#### Scenario: Entrega al usuario configurado
- **WHEN** la configuracion, documento y formato son validos
- **THEN** `print-silently` se publica con un `user` explicito igual a `print_user`

#### Scenario: Pestana no maestra del mismo usuario
- **WHEN** otra pestana del usuario impresor recibe el evento y su identificador no coincide
- **THEN** la pestana descarta la orden sin enviarla a HWB ni registrar el PDF

#### Scenario: Usuario distinto
- **WHEN** un usuario Desk distinto al impresor mantiene una sesion activa
- **THEN** esa sesion no recibe el payload PDF de la orden remota

### Requirement: Rotacion de la pestana al cambiar receptor
El sistema MUST invalidar la pestana maestra anterior cuando cambie el usuario
impresor.

#### Scenario: Cambio de usuario impresor
- **WHEN** un System Manager guarda un `print_user` diferente
- **THEN** el sistema limpia `tab_id` y exige que el nuevo usuario seleccione una pestana

### Requirement: Confidencialidad de observabilidad
El cliente y el servidor MUST NOT registrar PDF base64, cookies, tokens de
sesion ni contenido completo del documento.

#### Scenario: Recepcion de trabajo
- **WHEN** una pestana procesa o descarta un evento `print-silently`
- **THEN** ningun log de consola contiene `pdf`, `file_content` ni el payload completo

#### Scenario: Error backend
- **WHEN** falla la validacion o generacion de una orden
- **THEN** el log puede contener contexto tecnico minimo pero no contenido documental ni secretos
