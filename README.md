# Medical Biller PR 🏥

Facturación médica profesional para Puerto Rico. Sistema completo con clearinghouse Stedi, verificación de elegibilidad, análisis IA de denegaciones, y más.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | FastAPI + SQLAlchemy (SQLite/PostgreSQL) |
| Frontend | React 19 + Vite + Tailwind v4 |
| Clearinghouse | Stedi (EDI 837/835/271) |
| IA | OpenAI GPT-4o |
| Auth | JWT |

---

## Inicio rápido

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # edita con tus credenciales

# Inicializar base de datos + seed
python3 seed.py

# Servidor de desarrollo
uvicorn main:app --reload --port 8100
```

API docs disponibles en: http://localhost:8100/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App en: http://localhost:5174

---

## Variables de entorno (backend)

Copia `.env.example` → `.env` y configura:

| Variable | Descripción |
|---|---|
| `SECRET_KEY` | JWT secret (genera uno aleatorio) |
| `DATABASE_URL` | SQLite o PostgreSQL URL |
| `STEDI_API_KEY` | API key de stedi.com |
| `OPENAI_API_KEY` | API key de OpenAI |
| `WINK_API_URL` | URL de tu instancia Wink EHR |
| `WINK_API_KEY` | API key de Wink |

---

## Módulos

- **Dashboard** — KPIs: facturado MTD, cobrado MTD, tasa de cobro, apelaciones pendientes
- **Reclamaciones** — Pipeline completo (Borrador → Sometida → Aceptada → Pagada/Denegada)
- **Pacientes** — Registro + seguros primarios/secundarios
- **Proveedores** — NPI, taxonomía, licencias
- **Pagadores** — Directorio (Medicare, Medicaid, comerciales)
- **Elegibilidad** — Verificación en tiempo real vía Stedi (EDI 271/272)
- **Denegaciones** — Gestión con análisis IA y flujo de apelaciones
- **Importar** — Superbill CSV o sincronización con Wink EHR
- **Configuración** — Stedi, OpenAI, info de clínica, idioma

---

## Diseño

- Colores: Sky blue (`#0ea5e9`) + slate palette
- Español como idioma primario (PR), inglés secundario
- Sidebar colapsable con navegación por iconos

---

## Licencia

Privado — AccessIT Group / Rey
