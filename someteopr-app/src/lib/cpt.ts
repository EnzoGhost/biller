export interface CPTCode {
  code: string;
  description: string;
  descripcion: string; // Spanish
  standardFee: number;
}

export const OPTOMETRY_CPT_CODES: CPTCode[] = [
  // Eye exams - new patient
  { code: '92002', description: 'Ophthalmological services, new patient, intermediate', descripcion: 'Servicio oftalmológico, paciente nuevo, intermedio', standardFee: 85 },
  { code: '92004', description: 'Ophthalmological services, new patient, comprehensive', descripcion: 'Servicio oftalmológico, paciente nuevo, comprensivo', standardFee: 145 },
  // Eye exams - established patient
  { code: '92012', description: 'Ophthalmological services, established patient, intermediate', descripcion: 'Servicio oftalmológico, paciente establecido, intermedio', standardFee: 72 },
  { code: '92014', description: 'Ophthalmological services, established patient, comprehensive', descripcion: 'Servicio oftalmológico, paciente establecido, comprensivo', standardFee: 120 },
  // Refraction
  { code: '92015', description: 'Determination of refractive state', descripcion: 'Determinación del estado refractivo', standardFee: 55 },
  // Ophthalmoscopy
  { code: '92225', description: 'Ophthalmoscopy, extended; with retinal drawing, initial', descripcion: 'Oftalmoscopía extendida; con dibujo retiniano, inicial', standardFee: 95 },
  { code: '92226', description: 'Ophthalmoscopy, extended; with retinal drawing, subsequent', descripcion: 'Oftalmoscopía extendida; con dibujo retiniano, subsecuente', standardFee: 65 },
  // Fundus photography
  { code: '92250', description: 'Fundus photography with interpretation and report', descripcion: 'Fotografía de fondo de ojo con interpretación e informe', standardFee: 75 },
  // Visual fields
  { code: '92083', description: 'Visual field examination, extended examination', descripcion: 'Examen de campo visual, examen extendido', standardFee: 85 },
  { code: '92081', description: 'Visual field examination, limited examination', descripcion: 'Examen de campo visual, examen limitado', standardFee: 55 },
  { code: '92082', description: 'Visual field examination, intermediate examination', descripcion: 'Examen de campo visual, examen intermedio', standardFee: 65 },
  // OCT
  { code: '92133', description: 'Scanning computerized ophthalmic diagnostic imaging, optic nerve', descripcion: 'Imagen diagnóstica oftálmica computarizada, nervio óptico', standardFee: 95 },
  { code: '92134', description: 'Scanning computerized ophthalmic diagnostic imaging, retina', descripcion: 'Imagen diagnóstica oftálmica computarizada, retina', standardFee: 95 },
  { code: '92132', description: 'Scanning computerized ophthalmic diagnostic imaging, anterior segment', descripcion: 'Imagen diagnóstica oftálmica computarizada, segmento anterior', standardFee: 95 },
  // External photography
  { code: '92285', description: 'External ocular photography with interpretation and report', descripcion: 'Fotografía ocular externa con interpretación e informe', standardFee: 55 },
  // E/M office visits
  { code: '99213', description: 'Office or other outpatient visit, established patient, low complexity', descripcion: 'Visita a consultorio, paciente establecido, complejidad baja', standardFee: 110 },
  { code: '99214', description: 'Office or other outpatient visit, established patient, moderate complexity', descripcion: 'Visita a consultorio, paciente establecido, complejidad moderada', standardFee: 170 },
  { code: '99203', description: 'Office or other outpatient visit, new patient, low complexity', descripcion: 'Visita a consultorio, paciente nuevo, complejidad baja', standardFee: 145 },
  { code: '99204', description: 'Office or other outpatient visit, new patient, moderate complexity', descripcion: 'Visita a consultorio, paciente nuevo, complejidad moderada', standardFee: 210 },
  // Contact lens fitting
  { code: '92310', description: 'Contact lens fitting, corneal lens, both eyes', descripcion: 'Adaptación de lente de contacto, lente corneal, ambos ojos', standardFee: 120 },
  { code: '92311', description: 'Contact lens fitting, corneal lens, one eye', descripcion: 'Adaptación de lente de contacto, lente corneal, un ojo', standardFee: 85 },
  { code: '92326', description: 'Replacement of contact lens', descripcion: 'Reemplazo de lente de contacto', standardFee: 45 },
  // Foreign body removal
  { code: '65205', description: 'Removal of foreign body, external eye; conjunctival superficial', descripcion: 'Extracción de cuerpo extraño, ojo externo; conjuntival superficial', standardFee: 75 },
  { code: '65210', description: 'Removal of foreign body, external eye; conjunctival embedded', descripcion: 'Extracción de cuerpo extraño ocular; conjuntival incrustado', standardFee: 95 },
  { code: '65220', description: 'Removal of foreign body, external eye; corneal, without slit lamp', descripcion: 'Extracción de cuerpo extraño corneal, sin lámpara de hendidura', standardFee: 85 },
  { code: '65222', description: 'Removal of foreign body, external eye; corneal, with slit lamp', descripcion: 'Extracción de cuerpo extraño corneal, con lámpara de hendidura', standardFee: 110 },
  // Vision supplies
  { code: 'V2100', description: 'Sphere, single vision, plano to plus or minus 4.00d, per lens', descripcion: 'Esfera, visión sencilla, plano a +/-4.00d, por lente', standardFee: 65 },
  { code: 'V2200', description: 'Sphere, bifocal add, plano to plus 4.00d, per lens', descripcion: 'Esfera bifocal, plano a +4.00d, por lente', standardFee: 85 },
  { code: 'V2300', description: 'Sphere, trifocal, plano to plus 4.00d', descripcion: 'Esfera trifocal, plano a +4.00d', standardFee: 105 },
  { code: 'V2020', description: 'Frames, purchases', descripcion: 'Armazón, compra', standardFee: 110 },
  // Glaucoma tests
  { code: '92100', description: 'Serial tonometry, one or more measurements', descripcion: 'Tonometría serial, una o más mediciones', standardFee: 45 },
  { code: '92130', description: 'Water provocation test', descripcion: 'Prueba de provocación hídrica', standardFee: 75 },
  // Color vision
  { code: '92283', description: 'Color vision examination, extended', descripcion: 'Examen de visión de color, extendido', standardFee: 45 },
];

export function searchCPT(query: string, lang = 'en'): CPTCode[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return OPTOMETRY_CPT_CODES.filter(c => {
    const desc = lang.startsWith('es') ? c.descripcion.toLowerCase() : c.description.toLowerCase();
    return c.code.toLowerCase().includes(q) || desc.includes(q);
  }).slice(0, 10);
}
