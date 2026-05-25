"""
Puerto Rico Payer Mapping — Comprehensive alias/name resolution.

Used by both VistaNet import and AngelWink import flows to map
any insurance plan name to the correct AngelClaims payer entity.

Key insight: "Vital" suffix = Medicaid/Reforma. Every PR insurer brands
their government plan with "Vital." They have different payer IDs.
"""

# Maps normalized (uppercase, stripped) plan names → payer_id in our payers table.
# None = can't determine payer from this string alone.
PR_PAYER_ALIASES: dict[str, str | None] = {
    # ──────────────────────────────────────────────────────
    # Triple-S (GuideWell / BCBS PR) — Largest in PR
    # ──────────────────────────────────────────────────────
    # Commercial
    "TRIPLE-S": "TSS",
    "TRIPLE S": "TSS",
    "TRIPLE-S SALUD": "TSS",
    "TRIPLE S SALUD": "TSS",
    "TRIPLE-S PRIVADO": "TSS",
    "TRIPLE S PRIVADO": "TSS",
    "TSS": "TSS",
    "BLUE CROSS BLUE SHIELD PR": "TSS",
    "BLUE CROSS BLUE SHIELD OF PUERTO RICO": "TSS",
    "BLUE CROSS BLUE SHIELD PUERTO RICO": "TSS",
    "BCBS PR": "TSS",
    "BCBS PUERTO RICO": "TSS",
    "SEGUROS DE SERVICIOS DE SALUD": "TSS",
    "LA CRUZ AZUL": "TSS",  # historical, absorbed 2009
    "PROSAM": "TSS",  # PROSAM = Triple-S commercial product
    # Medicare Advantage
    "TRIPLE-S ADVANTAGE": "TSSA",
    "TRIPLE S ADVANTAGE": "TSSA",
    "TRIPLE-S MEDICARE": "TSSA",
    "TRIPLE S MEDICARE": "TSSA",
    "TRIPLE-S MEDICARE ADVANTAGE": "TSSA",
    "AMERICAN HEALTH MEDICARE": "TSSA",  # historical, absorbed 2014
    "AHM": "TSSA",  # historical
    # Medicaid / Reforma
    "TRIPLE-S VITAL": "TSSV",
    "TRIPLE S VITAL": "TSSV",
    "TRIPLE-S REFORMA": "TSSV",
    "TRIPLE-S GHP": "TSSV",
    "TRIPLE-S GOVERNMENT": "TSSV",
    "TRIPLE-S GOVERNMENT HEALTH PLAN": "TSSV",

    # ──────────────────────────────────────────────────────
    # MMM Healthcare (Elevance / Anthem)
    # ──────────────────────────────────────────────────────
    # Medicare Advantage (primary product)
    "MMM": "MMM",
    "MMM HEALTHCARE": "MMM",
    "MMM HEALTHCARE LLC": "MMM",
    "MMM MEDICARE": "MMM",
    "MMM HMO": "MMM",
    "MMM MEDICARE ADVANTAGE": "MMM",
    "MEDICARE Y MUCHO MAS": "MMM",
    "M.M.M.": "MMM",
    "MMM MULTI HEALTH": "MMM",  # delivery model, same entity
    # Medicaid / Reforma
    "MMM VITAL": "MMMVITAL",
    "MMM REFORMA": "MMMVITAL",
    # PMC (historical brand, aligned with MMM)
    "PMC": "PMC",
    "PMC MEDICARE CHOICE": "PMC",
    "PMC VITAL": "MMMVITAL",
    "PEOPLES MEDICARE": "PMC",  # historical
    # D-SNP (dual eligible)
    "MMM D-SNP": "MMM",  # bill to MMM as primary
    "MMM DUAL": "MMM",

    # ──────────────────────────────────────────────────────
    # MCS (Medical Card System) — Independent PR company
    # ──────────────────────────────────────────────────────
    # Commercial
    "MCS": "MCS",
    "MCS HEALTHCARE": "MCS",
    "MCS HEALTH PLAN": "MCS",
    "MCS SALUD": "MCS",
    "MCS HEALTH": "MCS",
    "MEDICAL CARD SYSTEM": "MCS",
    # Medicare Advantage
    "MCS CLASSICARE": "MCSMC",
    "MCS CLASSI CARE": "MCSMC",
    "MCS MEDICARE": "MCSMC",
    "MCS MEDICARE ADVANTAGE": "MCSMC",
    # Medicaid / Reforma
    "MCS VITAL": "MCSVITAL",
    "MCS REFORMA": "MCSVITAL",
    "MCS GOVERNMENT": "MCSVITAL",

    # ──────────────────────────────────────────────────────
    # First Medical Health Plan — Primarily commercial
    # ──────────────────────────────────────────────────────
    # Commercial
    "FIRST MEDICAL": "FMHP",
    "FIRST MEDICAL HEALTH PLAN": "FMHP",
    "FIRST MEDICAL HEALTH PLAN INC": "FMHP",
    "FMHP": "FMHP",
    # Medicaid / Reforma
    "FIRST MEDICAL VITAL": "FMVITAL",
    "FIRST MEDICAL REFORMA": "FMVITAL",

    # ──────────────────────────────────────────────────────
    # Plan de Salud Menonita (Hospital Menonita system)
    # ──────────────────────────────────────────────────────
    # Commercial
    "PLAN DE SALUD MENONITA": "MENONITA",
    "MENONITA": "MENONITA",
    "PSM": "MENONITA",
    "PLAN MENONITA": "MENONITA",
    "HOSPITAL MENONITA": "MENONITA",
    "MENONITA HEALTH PLAN": "MENONITA",
    # Medicaid / Reforma
    "PLAN DE SALUD MENONITA VITAL": "MENONITAV",
    "MENONITA VITAL": "MENONITAV",
    "PSM VITAL": "MENONITAV",
    "MENONITA REFORMA": "MENONITAV",

    # ──────────────────────────────────────────────────────
    # Humana — Medicare Advantage only in PR
    # ──────────────────────────────────────────────────────
    "HUMANA": "HUMPR",
    "HUMANA MEDICARE": "HUMPR",
    "HUMANA GOLD PLUS": "HUMPR",
    "HUMANA HONOR": "HUMPR",
    "HUMANA HMO": "HUMPR",
    "HUMANA PUERTO RICO": "HUMPR",
    "HUMANA MEDICARE ADVANTAGE": "HUMPR",

    # ──────────────────────────────────────────────────────
    # Medicare (Traditional / Original)
    # ──────────────────────────────────────────────────────
    "MEDICARE": "MEDICARE",
    "MEDICARE PART B": "MEDICARE",
    "MEDICARE PART A": "MEDICARE",
    "ORIGINAL MEDICARE": "MEDICARE",
    "TRADITIONAL MEDICARE": "MEDICARE",
    "MEDICARE FFS": "MEDICARE",
    "NOVITAS": "MEDICARE",  # historical MAC
    "FIRST COAST": "MEDICARE",  # current MAC for PR

    # ──────────────────────────────────────────────────────
    # Vision payers
    # ──────────────────────────────────────────────────────
    "ENVOLVE": "ENVOLVE",
    "ENVOLVE VISION": "ENVOLVE",
    "ENVOLVE VISION OF PUERTO RICO": "ENVOLVE",
    "CENTENE VISION": "ENVOLVE",
    "CENTENE VISION SERVICES": "ENVOLVE",
    "VSP": "VSP",
    "VISION SERVICE PLAN": "VSP",
    "EYEMED": "EYEMED",
    "DAVIS VISION": "DAVISVISION",

    # ──────────────────────────────────────────────────────
    # Other PR payers
    # ──────────────────────────────────────────────────────
    "MOLINA": "MHPR",
    "MOLINA HEALTHCARE": "MHPR",
    "MOLINA HEALTHCARE OF PUERTO RICO": "MHPR",
    "MAPFRE": "MAPFRE",
    "MAPFRE SEGUROS": "MAPFRE",
    "MAPFRE PUERTO RICO": "MAPFRE",
    "MAPFRE PR": "MAPFRE",
    "AETNA": "AETNA",
    "AETNA HEALTH": "AETNA",
    "CVS AETNA": "AETNA",
    "CIGNA": "CIGNA",
    "CIGNA HEALTHCARE": "CIGNA",
    "CIGNA HEALTH": "CIGNA",

    # ──────────────────────────────────────────────────────
    # Government / Generic
    # ──────────────────────────────────────────────────────
    "REFORMA": None,  # Need specific Vital plan
    "PLAN DE SALUD DEL GOBIERNO": None,  # Need specific MCO
    "PLAN VITAL": None,  # Need specific MCO
    "MEDICAID": None,  # Need specific Vital plan
    "ASES": None,  # ASES administers, doesn't pay — need specific MCO
    "GHP": None,  # Government Health Plan — need specific MCO

    # ──────────────────────────────────────────────────────
    # Clearinghouse names (sometimes appear as "payer" on imports)
    # ──────────────────────────────────────────────────────
    "INMEDIATA": None,  # Clearinghouse, not a payer
    "CHANGE HEALTHCARE": None,
    "AVAILITY": None,

    # ──────────────────────────────────────────────────────
    # Generic / ambiguous
    # ──────────────────────────────────────────────────────
    "PRIVADO": None,  # "Private" — can't map without more info
    "PARTICULAR": None,  # Self-pay
    "SELF PAY": None,
    "NO INSURANCE": None,
    "SIN PLAN": None,
    "CASH": None,
}


# ──────────────────────────────────────────────────────────────────────────────
# Inmediata Payer IDs — from their "Payer list = Eligibility Required Fields.xlsx"
# These are the actual IDs used in X12 EDI transactions through Inmediata/SecureTrack.
# ──────────────────────────────────────────────────────────────────────────────
INMEDIATA_PAYER_IDS: dict[str, str] = {
    "TSS": "973",                # Triple-S (commercial)
    "TSSA": "973MA",             # Triple-S Advantage (Medicare)
    "TSSV": "973",               # Triple-S Vital (Reforma) — same base ID, verify suffix
    "MCS": "660396197P",          # MCS Healthcare
    "MCSMC": "660396197P",        # MCS Classicare — likely same, verify
    "MCSVITAL": "660396197P",     # MCS Vital — likely same, verify
    "MMM": "660588600",           # MMM Healthcare (Medicare Advantage)
    "MMMVITAL": "660653763",      # MMM/PMC MultiHealth (Medicaid)
    "PMC": "660592131",           # PMC Medicare Choice
    "FMHP": "660537624",          # First Medical (Commercial)
    "FMVITAL": "GHP660537624",    # First Medical GHP/Vital (Reforma)
    "MENONITA": "660636242",      # Plan de Salud Menonita (Commercial)
    "MENONITAV": "660636242PSG",  # Plan de Salud Menonita GHP (Reforma)
    "HUMPR": "61101",             # Humana Medicare
    "MAPFRE": "4600012",          # MAPFRE
    "MEDICARE": "00973",          # CMS Medicare Part A/B
    "CIGNA": "62308PR",           # Cigna (PR-specific)
    "AETNA": "60054",             # Aetna (national)
    # Payers in Inmediata's list that we don't have entities for yet:
    # "ASOCMAESTROS": "660194027",  # Asociacion de Maestros
    # "FHCPR": "660584821",        # FHC of PR
    # "UTM": "660202379",          # Plan de Bienestar UTM
    # "BELLAVISTA": "660524575",   # Plan de Salud Bella Vista
    # "AUXILIOSOCIOS": "660178704",# Auxilio Plan de Socios
    # "AUXILIOSALUD": "660647362", # Auxilio Salud Plus
    # "DELTADENTAL": "660436769",  # Delta Dental PR
}


# Seed payers — canonical list for new AngelClaims deployments.
# Each entry: (payer_id, name, payer_type, inmediata_payer_id, notes)
SEED_PAYERS = [
    # Triple-S group
    ("TSS", "Triple-S Salud", "COMMERCIAL", "973", "BCBS PR. Largest commercial insurer in PR."),
    ("TSSA", "Triple-S Advantage", "MEDICARE", "973MA", "Triple-S Medicare Advantage plan."),
    ("TSSV", "Triple-S Vital", "MEDICAID", "973", "Triple-S Reforma/Medicaid product."),
    # MMM group
    ("MMM", "MMM Healthcare", "MEDICARE", "660588600", "Elevance/Anthem. #1 Medicare Advantage in PR. CMS H4004."),
    ("MMMVITAL", "MMM Vital", "MEDICAID", "660653763", "MMM Reforma/Medicaid product."),
    ("PMC", "PMC Medicare Choice", "MEDICARE", "660592131", "Historical brand aligned with MMM."),
    # MCS group
    ("MCS", "MCS Healthcare", "COMMERCIAL", "660396197P", "Medical Card System. Independent PR company."),
    ("MCSMC", "MCS Classicare", "MEDICARE", "660396197P", "MCS Medicare Advantage plan."),
    ("MCSVITAL", "MCS Vital", "MEDICAID", "660396197P", "MCS Reforma/Medicaid product."),
    # First Medical group
    ("FMHP", "First Medical Health Plan", "COMMERCIAL", "660537624", "Primarily commercial PR insurer."),
    ("FMVITAL", "First Medical Vital", "MEDICAID", "GHP660537624", "First Medical Reforma/Medicaid. Was mail-only, now via Inmediata."),
    # Menonita group
    ("MENONITA", "Plan de Salud Menonita", "COMMERCIAL", "660636242", "Hospital Menonita system. Central/south PR."),
    ("MENONITAV", "Plan de Salud Menonita VITAL", "MEDICAID", "660636242PSG", "Menonita Reforma/Medicaid."),
    # Humana
    ("HUMPR", "Humana Puerto Rico", "MEDICARE", "61101", "Humana Medicare Advantage only in PR."),
    # Medicare
    ("MEDICARE", "Medicare (Original)", "MEDICARE", "00973", "Traditional Medicare FFS. MAC: First Coast (FCSO)."),
    # Vision
    ("ENVOLVE", "Envolve Vision of Puerto Rico", "VISION", None, "Centene subsidiary. Vision benefits for Medicaid/MA."),
    ("VSP", "VSP Vision", "VISION", None, "Vision Service Plan. National."),
    ("EYEMED", "EyeMed", "VISION", None, "National vision plan."),
    ("DAVISVISION", "Davis Vision", "VISION", None, "National vision plan."),
    # Other
    ("MHPR", "Molina Healthcare of Puerto Rico", "MEDICAID", None, "National Medicaid MCO with PR presence."),
    ("MAPFRE", "MAPFRE Puerto Rico", "COMMERCIAL", "4600012", "Spain-based. Primarily P&C, some health."),
    ("AETNA", "Aetna", "COMMERCIAL", "60054", "CVS Health. Limited PR commercial presence."),
    ("CIGNA", "Cigna Healthcare", "COMMERCIAL", "62308PR", "Limited PR presence."),
    ("ASES", "Plan de Salud del Gobierno (ASES/GHP)", "MEDICAID", None, "Government plan admin. Route to specific Vital MCO."),
]
