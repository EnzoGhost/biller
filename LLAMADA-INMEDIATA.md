# 📞 Llamada con Inmediata — Guía Rápida

## Tu info (para que no tengas que buscar nada)

- **Nombre:** Angel Reynaldo Cortes
- **Email:** r3ycortes@gmail.com
- **Teléfono:** 787-549-1572
- **Caso activo:** #01787107 (Keishla Diaz Miranda / Supervisora Liza Baquero)
- **Contrato:** SecureClaim desde 2013, a nombre de la Dra. Brenda Cubero
- **Ya eres contacto autorizado** en la cuenta de Inmediata

## Datos de la clínica

- **Clínica:** Visual Zone Optical Outlet
- **Doctora:** Dra. Brenda Cubero
- **NPI:** 1164586079 ← *verificar con mami si es correcto*
- **EIN / Tax ID:** *preguntarle a mami — no lo tenemos confirmado*
- **Taxonomy:** 152W00000X (Optometría)
- **Dirección:** Manatí, PR ← *confirmar dirección exacta con mami*
- **Localidad en VistaNet:** MANATI

---

## Lo que NECESITAS sacar de esta llamada

### 1. Credenciales del API
- **API key** o Client ID + Secret — lo que usen ellos para autenticar
- **URL del endpoint** (ej. https://api.inmediata.com/v1/claims)
- **¿Hay ambiente de prueba (sandbox)?** ← IMPORTANTE — necesitamos probar antes de mandar reclamaciones reales
- **¿El sandbox usa una clave diferente?**

### 2. Documentación técnica
- **¿Tienen documentación del API?** PDF, página web, Swagger, lo que sea
- **¿Tienen guía de Puerto Rico para 837P?** (Companion Guide)

### 3. Formato y método
- **¿Es REST API o es subir archivos 837 por SFTP?**
  - Si es REST: ¿JSON o X12 EDI dentro del body?
  - Si es SFTP: ¿credenciales y rutas de carpeta?
- **¿Se pueden enviar reclamaciones una a una (real-time) o solo en lote (batch)?**

### 4. Respuestas y pagos
- **¿Cómo nos llegan los acuses de recibo?** (999 / 277CA)
- **¿Cómo recibimos los ERA (remesas de pago)?** (835)
  - ¿Por API? ¿SFTP? ¿Portal SecureClaim?

### 5. Restricciones
- **¿La API key está atada a una IP fija?** ← Nosotros trabajamos desde laptops, no servidores fijos
- **¿Hay límite de llamadas por minuto/hora?** (rate limits)
- **¿Un API key puede manejar múltiples NPIs en el futuro?**

### 6. Lista de Payer IDs
- **¿Tienen lista de Payer IDs que aceptan?** (Triple-S, MCS, MMM, First Medical, etc.)

---

## Lo que ellos probablemente te van a preguntar

### "¿Qué sistema están usando?"
> "Tenemos un sistema propio de facturación médica. Se llama SometeoPR. Ya genera los archivos 837P en formato X12 EDI 5010A1. Lo que necesitamos es conectarnos a su API para enviar las reclamaciones directamente."

### "¿Qué transacciones necesitan?"
> "Primero que nada, 837P para reclamaciones profesionales. También nos interesa recibir los 835 (remesas de pago) electrónicamente. Y si tienen eligibilidad (270/271) por API, también nos interesa."

### "¿Desde dónde se van a conectar?"
> "Desde una aplicación web. El servidor está en un VPS con IP fija, pero también probamos desde máquinas locales. Por eso pregunto si la API key está atada a IP."

### "¿Necesitan ImPlug?"
> "No, ya no. Preferimos el API directamente. El formulario de ImPlug que enviamos antes era cuando no había API disponible."

### "¿Ya tienen submitter ID?"
> "Todavía no — entiendo que ustedes nos lo asignan. ¿O usamos el que ya tiene la Dra. Cubero en SecureClaim?"

---

## Después de la llamada

Cuando tengas las credenciales y la documentación:
1. Me pasas el API key, la URL, y el submitter ID
2. Yo lo conecto al sistema ese mismo día
3. Mandamos una reclamación de prueba en sandbox
4. Si funciona, pasamos a producción

---

*Si te dicen "API" como "a-pi" (o suena como "papi" sin la primera P), es lo mismo 😂*
