# 📞 Inmediata Call Script — SFTP Access Request

## Who to call
**Inmediata Health Group**
- Phone: **787-641-6500**
- Hours: Mon-Fri 8AM-5PM AST
- Ask for: **Technical Support** or **EDI Department**

## What to have ready BEFORE calling
1. **Clinic name** (your mom's exact clinic name as registered)
2. **NPI number** (10-digit National Provider Identifier — ask your mom)
3. **Tax ID / EIN** (employer identification number — ask your mom)
4. **Contact email** (where they'll send the SFTP credentials)
5. **Phone number** (clinic phone on file with them)
6. **Billing software name** — say: **"Biller PR"** (our app)

## What to say (word for word)

> "Hola, buenos días. Estoy llamando de parte de [NOMBRE DE LA CLÍNICA], NPI [NÚMERO]. 
> 
> Estamos implementando un sistema de facturación electrónica nuevo y necesitamos acceso SFTP para envío de reclamaciones en batch y recibir ERAs.
> 
> Necesitamos:
> 1. Las credenciales de SFTP — hostname, usuario, y contraseña
> 2. El directorio donde subir archivos 837P
> 3. El directorio donde descargar archivos 835 (ERAs)
> 4. El Submitter ID de la clínica
> 5. Cualquier documentación de integración que tengan
>
> El software se llama Biller PR. Enviamos archivos en formato X12 837P versión 5010."

## If they ask questions

**"¿Qué es SFTP?"**
> "Secure File Transfer Protocol. Es el método estándar para enviar archivos de reclamaciones electrónicas en batch, en vez de entrarlas una por una por el portal."

**"¿Ya tienen cuenta con nosotros?"**
> "Sí, la clínica ya tiene cuenta activa con Inmediata. Usamos el portal para someter reclamaciones. Ahora necesitamos acceso SFTP además del portal para automatizar el proceso."

**"¿Cuál es el formato?"**
> "ANSI X12 837P versión 5010, HIPAA compliant."

**"¿Necesitan algún acuerdo o formulario?"**
> "Sí, lo que necesiten. Pueden enviar los formularios por email a [EMAIL]."

**"Eso tiene costo adicional?"**
> Probably not — SFTP is usually included in their $140/month plan. If they say yes, ask how much and we'll decide.

## What they should send you (by email)
1. ✅ SFTP hostname (something like `sftp.inmediata.com`)
2. ✅ SFTP username
3. ✅ SFTP password
4. ✅ Upload directory path (for 837P files)
5. ✅ Download directory path (for 835 ERA files)
6. ✅ Submitter ID (for the ISA segment of EDI files)
7. ✅ Any companion guide or integration docs
8. ✅ Test environment info (if they have one)

## After the call
Send everything to Rey → I'll configure it in the biller app `.env`:
```
INMEDIATA_SFTP_HOST=sftp.inmediata.com
INMEDIATA_SFTP_USER=your_username
INMEDIATA_SFTP_PASSWORD=your_password
INMEDIATA_SFTP_UPLOAD_DIR=/UPLOAD/837
INMEDIATA_SFTP_DOWNLOAD_DIR=/DOWNLOAD/835
INMEDIATA_SUBMITTER_ID=your_submitter_id
```

## Timeline
- They usually send SFTP creds within **1-3 business days**
- Some clearinghouses need a **connectivity test** before going live
- If they say it takes weeks, push back — SFTP access is standard and should be quick
