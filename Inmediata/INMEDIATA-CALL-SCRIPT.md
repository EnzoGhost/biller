# 📞 Inmediata — Integration Setup

## Contact Info
- **Phone:** (787) 783-3233
- **Email:** techsupport@inmediata.com
- **Hours:** Mon-Fri 8AM-5PM AST

## Option 1: Email First (Recommended)

Skip the phone. Send this email to **techsupport@inmediata.com**:

---

**Subject:** Solicitud de integración — [NOMBRE DE LA CLÍNICA] — NPI [NÚMERO]

Estimados,

Estamos implementando un sistema de facturación electrónico nuevo llamado **SometeoPR** para la clínica [NOMBRE DE LA CLÍNICA], NPI [NÚMERO], Tax ID [NÚMERO].

La clínica ya tiene cuenta activa con Inmediata y usa SecureTrack para someter reclamaciones. Ahora necesitamos integrar nuestro sistema directamente con Inmediata para automatizar el envío de reclamaciones y la recepción de ERAs.

Necesitamos lo siguiente:

1. **Opciones de integración disponibles** — ¿Ofrecen SFTP, API (REST/SOAP), o solo el portal web para batch upload?
2. **Credenciales de acceso SFTP** (si aplica) — hostname, usuario, contraseña, directorios de upload/download
3. **Submitter ID** de la clínica para el segmento ISA del archivo EDI
4. **Companion Guide** o documentación de integración para 837P (Professional) y 835 (ERA)
5. **Ambiente de pruebas** — ¿Tienen un sandbox o entorno de testing?
6. **Requisitos de formato** — Confirmamos que generamos archivos ANSI X12 837P versión 5010, HIPAA compliant

Nuestro software (SometeoPR) genera archivos 837P y puede procesar 835 ERAs automáticamente. Necesitamos saber cuál es el método preferido para conectar con ustedes.

Pueden enviar la información a: [TU EMAIL]

Gracias,
[TU NOMBRE]
[NOMBRE DE LA CLÍNICA]
Tel: [TELÉFONO]

---

## Option 2: Phone Call

If email doesn't get a response within 2-3 business days, call (787) 783-3233.

### What to have ready:
1. **Clinic name** (exact as registered with Inmediata)
2. **NPI number** (10-digit)
3. **Tax ID / EIN**
4. **Your email** (where they'll send creds/docs)
5. **Software name:** say **"SometeoPR"**

### What to say:

> "Hola, buenos días. Estoy llamando de parte de [NOMBRE DE LA CLÍNICA], NPI [NÚMERO].
>
> Ya tenemos cuenta activa con Inmediata — usamos SecureTrack. Estamos implementando un sistema de facturación nuevo que se llama SometeoPR y necesitamos integración directa.
>
> Primero: ¿Cuáles son las opciones de integración que ofrecen? ¿Tienen SFTP, API, o solo batch upload por el portal?
>
> Necesitamos:
> 1. Credenciales de SFTP o API — lo que tengan disponible
> 2. El Submitter ID de la clínica
> 3. Documentación de integración o companion guide
> 4. Acceso a un ambiente de pruebas si tienen uno
>
> SometeoPR genera archivos X12 837P versión 5010 y puede recibir 835 para reconciliación automática de pagos."

### If they push back or ask questions:

**"Solo tienen que usar el portal SecureTrack"**
> "Entiendo, pero necesitamos automatizar el proceso. El portal es manual — nuestro sistema genera cientos de reclamaciones. ¿No tienen opción de batch upload automático, SFTP, o web service?"

**"Eso es solo para software vendors certificados"**
> "OK, ¿cuál es el proceso de certificación? ¿Qué formularios necesitamos llenar?"

**"Tiene costo adicional"**
> "¿Cuánto? La clínica ya paga $140 al mes."

**"Necesitan llenar un formulario de Trading Partner"**
> "Perfecto, pueden enviar el formulario a [EMAIL]."

**"No ofrecemos SFTP/API"**
> "OK, ¿entonces el batch upload por el portal web acepta archivos 837P? ¿O solo entrada manual?"
> If yes to 837P upload: "Eso nos funciona. ¿Tienen documentación del formato que aceptan?"

## What We Need From Them

| Item | Priority | Notes |
|------|----------|-------|
| Integration method (SFTP/API/portal upload) | 🔴 Critical | Determines our architecture |
| SFTP credentials (host, user, pass, dirs) | 🔴 Critical | If SFTP available |
| Submitter ID | 🔴 Critical | For ISA segment in EDI files |
| Companion guide / integration docs | 🟡 Important | Format requirements, business rules |
| Test environment | 🟡 Important | For safe testing before live |
| Trading Partner Agreement | 🟢 Nice | May be required before go-live |

## After Getting the Info

Send everything to Enzo. I'll configure it in SometeoPR's `.env`:
```
INMEDIATA_SFTP_HOST=sftp.inmediata.com
INMEDIATA_SFTP_USER=your_username
INMEDIATA_SFTP_PASSWORD=your_password
INMEDIATA_SFTP_UPLOAD_DIR=/UPLOAD/837
INMEDIATA_SFTP_DOWNLOAD_DIR=/DOWNLOAD/835
INMEDIATA_SUBMITTER_ID=your_submitter_id
```

## Fallback Plan

If Inmediata only supports manual portal entry (no SFTP, no API, no batch upload):
1. We generate 837P files in SometeoPR
2. Ruth uploads them manually via SecureTrack's batch upload feature
3. We download 835 ERAs from SecureTrack manually
4. Long-term: migrate to Stedi when we have enough volume to justify $500/month

This isn't ideal but it still saves Ruth 80% of the work — she just drags and drops a file instead of typing every claim by hand.
