-- SometeoPR Seed Data
-- Puerto Rico optometry billing data

-- Default admin user (password: Admin1234!)
-- bcrypt hash of 'Admin1234!' — for local desktop use, we skip bcrypt and use plaintext check
INSERT OR IGNORE INTO users (email, full_name, hashed_password, role)
VALUES ('admin@biller.pr', 'Administrador del Sistema', 'Admin1234!', 'admin');

INSERT OR IGNORE INTO users (email, full_name, hashed_password, role)
VALUES ('biller@biller.pr', 'María Facturadora', 'Biller1234!', 'biller');

-- Default clinic settings
INSERT OR IGNORE INTO clinic_settings (id, clinic_name, city, state, setup_complete)
VALUES (1, 'Clínica de Optometría PR', 'San Juan', 'PR', 0);

-- ── Payers ───────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('Triple-S Salud', 'TSS', 'commercial', 'stedi', 'VMJBW', 'PO Box 363628', 'San Juan', '00936', '787-774-6060', 180, 'Largest commercial insurer in Puerto Rico. Stedi ID: VMJBW');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('MCS Healthcare', 'MCS', 'commercial', 'stedi', 'OLFKO', 'PO Box 9023518', 'San Juan', '00902', '787-763-4949', 180, 'MCS Healthcare PR. Stedi ID: OLFKO');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('MMM Healthcare', 'MMM', 'medicare', 'stedi', 'DCURP', 'PO Box 195009', 'San Juan', '00919', '787-774-6700', 365, 'Medicare Advantage plan in PR. Stedi ID: DCURP');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('First Medical Health Plan', 'FMHP', 'commercial', 'stedi', 'FMKIY', 'PO Box 9023005', 'San Juan', '00902', '787-474-7474', 180, 'First Medical Health Plan. Stedi ID: FMKIY');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('Humana Puerto Rico', 'HUMPR', 'medicare', 'stedi', 'GZMSV', '500 W. Main Street', 'San Juan', '00918', '800-448-6262', 365, 'Humana Puerto Rico Medicare Advantage. Stedi ID: GZMSV');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, state, zip_code, phone, timely_filing_days, notes)
VALUES ('Medicare / Novitas Solutions', 'MEDICARE', 'medicare', 'stedi', 'KXVQE', 'PO Box 3080', 'Mechanicsburg', 'PA', '17055', '855-252-8782', 365, 'Novitas Solutions is MAC for PR (J12). Medicare Part B.');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, state, zip_code, phone, timely_filing_days, notes)
VALUES ('Envolve Vision of Puerto Rico', 'ENVOLVE', 'vision', 'stedi', 'WSXQY', 'PO Box 17367', 'Richmond', 'VA', '23226', '800-282-3232', 365, 'Vision carve-out TPA. Availity clearinghouse. Payer ID 56190. ~35% TPA fee.');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, inmediata_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('Molina Healthcare of Puerto Rico', 'MHPR', 'medicaid', 'inmediata', 'MHPR1', 'PO Box 29030', 'San Juan', '00929', '787-474-8300', 365, 'Medicaid managed care. Use Inmediata for EDI submission.');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, inmediata_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('Plan de Salud del Gobierno (ASES/GHP)', 'ASES', 'medicaid', 'inmediata', 'ASES1', 'PO Box 195009', 'San Juan', '00919', '787-474-3300', 365, 'Government Health Plan. Via Inmediata clearinghouse.');

INSERT OR IGNORE INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, address_line1, city, zip_code, phone, timely_filing_days, notes)
VALUES ('PMC Medicare Choice', 'PMC', 'medicare', 'stedi', 'PMC01', 'PO Box 192296', 'San Juan', '00919', '787-993-3000', 365, 'PMC Medicare Choice PR');

-- ── Providers ────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO providers (npi, first_name, last_name, specialty, taxonomy_code, license_number, address_line1, city, state, zip_code, phone, ein)
VALUES ('1234567893', 'José', 'Martínez', 'Optometry', '152W00000X', 'OD-PR-1042', 'Centro Médico Oftalmo, Suite 201', 'San Juan', 'PR', '00918', '787-722-4000', '66-0654321');

INSERT OR IGNORE INTO providers (npi, first_name, last_name, specialty, taxonomy_code, license_number, address_line1, city, state, zip_code, phone, ein)
VALUES ('1234567901', 'Carmen', 'Rodríguez', 'Ophthalmology', '207W00000X', 'MD-PR-5512', '400 Av. Hostos, Edif. B', 'San Juan', 'PR', '00918', '787-764-3000', '66-0123456');

INSERT OR IGNORE INTO providers (npi, first_name, last_name, specialty, taxonomy_code, license_number, address_line1, city, state, zip_code, phone, ein)
VALUES ('1234567919', 'Miguel', 'Santos', 'Optometry', '152W00000X', 'OD-PR-2201', 'Plaza Carolina Mall, Local 45', 'Carolina', 'PR', '00987', '787-768-5500', '66-0987654');

-- ── Patients ─────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, email, address_line1, city, state, zip_code)
VALUES ('PR000001', 'Carlos', 'Rivera', '1978-06-15', 'M', '787-555-1234', 'carlos.rivera@email.com', 'Urb. San Francisco, Calle Almendro 45', 'San Juan', 'PR', '00927');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, email, address_line1, city, state, zip_code)
VALUES ('PR000002', 'María', 'Ortiz', '1990-03-22', 'F', '787-555-5678', 'maria.ortiz@gmail.com', 'Cond. Torres de Madrid, Apt 5B', 'Guaynabo', 'PR', '00969');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, address_line1, city, state, zip_code)
VALUES ('PR000003', 'Luis', 'González', '1952-11-08', 'M', '787-555-9012', 'HC-02 Box 15432', 'Bayamón', 'PR', '00956');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, address_line1, city, state, zip_code)
VALUES ('PR000004', 'Lucía', 'Hernández', '2005-08-30', 'F', '787-555-3456', 'Urb. Villa del Rey, Calle 12 #23', 'Caguas', 'PR', '00725');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, address_line1, city, state, zip_code)
VALUES ('PR000005', 'Roberto', 'Colón', '1967-04-14', 'M', '787-555-7890', 'Ave. Ponce de León 1200', 'Santurce', 'PR', '00907');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, address_line1, city, state, zip_code)
VALUES ('PR000006', 'Ana', 'Ramírez', '1960-01-19', 'F', '787-555-2233', 'Calle Loíza 1845, Apt 3', 'San Juan', 'PR', '00911');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, address_line1, city, state, zip_code)
VALUES ('PR000007', 'Pedro', 'Torres', '1985-09-05', 'M', '787-555-6677', 'Urb. Caparra Heights, Calle E-5', 'Guaynabo', 'PR', '00968');

INSERT OR IGNORE INTO patients (mrn, first_name, last_name, dob, gender, phone, address_line1, city, state, zip_code)
VALUES ('PR000008', 'Isabel', 'Morales', '1972-12-03', 'F', '787-555-8899', 'Residencial Buen Consejo, Edif 12 Apt 4', 'San Juan', 'PR', '00926');

-- ── Patient Insurances ────────────────────────────────────────────────────────

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, group_number, is_primary)
SELECT p.id, py.id, 'TSS-987654321', 'GRP-001', 1
FROM patients p, payers py WHERE p.mrn='PR000001' AND py.payer_id='TSS';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, 'MCS-123456789', 1
FROM patients p, payers py WHERE p.mrn='PR000002' AND py.payer_id='MCS';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, '1EG4-TE5-MK72', 1
FROM patients p, payers py WHERE p.mrn='PR000003' AND py.payer_id='MEDICARE';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, 'ASES-PR-456789', 1
FROM patients p, payers py WHERE p.mrn='PR000004' AND py.payer_id='ASES';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, 'MMM-789012345', 1
FROM patients p, payers py WHERE p.mrn='PR000005' AND py.payer_id='MMM';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, 'HUM-PR-334455', 1
FROM patients p, payers py WHERE p.mrn='PR000006' AND py.payer_id='HUMPR';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, 'FMHP-556677', 1
FROM patients p, payers py WHERE p.mrn='PR000007' AND py.payer_id='FMHP';

INSERT OR IGNORE INTO patient_insurances (patient_id, payer_id, member_id, is_primary)
SELECT p.id, py.id, 'ENV-PR-998877', 1
FROM patients p, payers py WHERE p.mrn='PR000008' AND py.payer_id='ENVOLVE';

-- ── Sample Claims ─────────────────────────────────────────────────────────────

-- Paid claim: Carlos Rivera / TSS
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, date_of_submission, place_of_service, diagnosis_codes, total_billed, total_paid, source)
SELECT 'CLM-20250108-AA001', pat.id, prov.id, pay.id, 'paid', '2025-01-08', '2025-01-11', '11', '["H52.11","H52.223"]', 250.00, 200.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000001' AND prov.npi='1234567893' AND pay.payer_id='TSS';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, paid_amount, diagnosis_pointers)
SELECT c.id, 1, '92004', 'Comprehensive ophthalmological exam, new patient', '2025-01-08', 1, 195.00, 155.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250108-AA001';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, paid_amount, diagnosis_pointers)
SELECT c.id, 2, '92015', 'Determination of refractive state', '2025-01-08', 1, 55.00, 45.00, '[1,2]'
FROM claims c WHERE c.claim_number='CLM-20250108-AA001';

INSERT OR IGNORE INTO payments (claim_id, check_number, check_date, payment_amount, adjustment_amount, payment_method)
SELECT c.id, 'TSS-CHK-44521', '2025-02-05', 200.00, 50.00, 'eft'
FROM claims c WHERE c.claim_number='CLM-20250108-AA001';

-- Paid claim: María Ortiz / MCS
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, date_of_submission, place_of_service, diagnosis_codes, total_billed, total_paid, source)
SELECT 'CLM-20250115-BB002', pat.id, prov.id, pay.id, 'paid', '2025-01-15', '2025-01-18', '11', '["H40.1130","H40.1131"]', 420.00, 344.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000002' AND prov.npi='1234567893' AND pay.payer_id='MCS';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, paid_amount, diagnosis_pointers)
SELECT c.id, 1, '92014', 'Comprehensive ophthalmological exam, established patient', '2025-01-15', 1, 145.00, 118.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250115-BB002';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, paid_amount, diagnosis_pointers)
SELECT c.id, 2, '92083', 'Visual field examination, bilateral', '2025-01-15', 1, 180.00, 148.00, '[1,2]'
FROM claims c WHERE c.claim_number='CLM-20250115-BB002';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, paid_amount, diagnosis_pointers)
SELECT c.id, 3, '92250', 'Fundus photography with interpretation', '2025-01-15', 1, 95.00, 78.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250115-BB002';

INSERT OR IGNORE INTO payments (claim_id, check_number, check_date, payment_amount, adjustment_amount, payment_method)
SELECT c.id, 'MCS-EFT-88921', '2025-02-16', 344.00, 76.00, 'eft'
FROM claims c WHERE c.claim_number='CLM-20250115-BB002';

-- Submitted claim: Lucía Hernández / ASES
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, date_of_submission, place_of_service, diagnosis_codes, total_billed, total_paid, source)
SELECT 'CLM-20250305-CC003', pat.id, prov.id, pay.id, 'submitted', '2025-03-05', '2025-03-08', '11', '["H52.223","H10.013"]', 150.00, 0.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000004' AND prov.npi='1234567893' AND pay.payer_id='ASES';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 1, '92012', 'Ophthalmological exam, established patient, intermediate', '2025-03-05', 1, 95.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250305-CC003';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 2, '92015', 'Determination of refractive state', '2025-03-05', 1, 55.00, '[1,2]'
FROM claims c WHERE c.claim_number='CLM-20250305-CC003';

-- Denied claim: Luis González / Medicare
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, date_of_submission, place_of_service, diagnosis_codes, total_billed, total_paid, source)
SELECT 'CLM-20250203-DD004', pat.id, prov.id, pay.id, 'denied', '2025-02-03', '2025-02-06', '11', '["Z01.00"]', 200.00, 0.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000003' AND prov.npi='1234567901' AND pay.payer_id='MEDICARE';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 1, '92015', 'Determination of refractive state', '2025-02-03', 1, 55.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250203-DD004';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 2, '92310', 'Fitting of contact lens, aphakia, one eye', '2025-02-03', 1, 145.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250203-DD004';

INSERT OR IGNORE INTO denials (claim_id, denial_code, denial_reason, denial_date, carc_code, rarc_code)
SELECT c.id, 'CO-96', 'Non-covered charge: Routine refraction and contact lens fitting not covered by Medicare', '2025-02-18', '96', 'N130'
FROM claims c WHERE c.claim_number='CLM-20250203-DD004';

-- Draft claim: Ana Ramírez / Humana
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, place_of_service, diagnosis_codes, total_billed, source)
SELECT 'CLM-20250320-EE005', pat.id, prov.id, pay.id, 'draft', '2025-03-20', '11', '["H35.30","H35.31"]', 270.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000006' AND prov.npi='1234567893' AND pay.payer_id='HUMPR';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 1, '92250', 'Fundus photography', '2025-03-20', 1, 95.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250320-EE005';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 2, '92134', 'Scanning computerized ophthalmic diagnostic imaging, posterior', '2025-03-20', 1, 175.00, '[1,2]'
FROM claims c WHERE c.claim_number='CLM-20250320-EE005';

-- Accepted claim: Pedro Torres / FMHP
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, date_of_submission, place_of_service, diagnosis_codes, total_billed, source)
SELECT 'CLM-20250315-FF006', pat.id, prov.id, pay.id, 'accepted', '2025-03-15', '2025-03-18', '11', '["H52.10","H52.223"]', 335.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000007' AND prov.npi='1234567919' AND pay.payer_id='FMHP';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 1, '92004', 'Comprehensive ophthalmological exam, new patient', '2025-03-15', 1, 195.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250315-FF006';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 2, '92015', 'Determination of refractive state', '2025-03-15', 1, 55.00, '[1,2]'
FROM claims c WHERE c.claim_number='CLM-20250315-FF006';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 3, '92310', 'Fitting of spectacle lenses', '2025-03-15', 1, 85.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250315-FF006';

-- Rejected claim: Carlos Rivera / TSS
INSERT OR IGNORE INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, date_of_submission, place_of_service, diagnosis_codes, total_billed, source)
SELECT 'CLM-20250220-GG007', pat.id, prov.id, pay.id, 'rejected', '2025-02-20', '2025-02-23', '11', '["H40.10X0"]', 345.00, 'seed'
FROM patients pat, providers prov, payers pay WHERE pat.mrn='PR000001' AND prov.npi='1234567893' AND pay.payer_id='TSS';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 1, '92083', 'Visual field examination', '2025-02-20', 1, 180.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250220-GG007';

INSERT OR IGNORE INTO service_lines (claim_id, line_number, cpt_code, description, service_date, units, billed_amount, diagnosis_pointers)
SELECT c.id, 2, '92133', 'Scanning laser ophthalmoscopy, anterior', '2025-02-20', 1, 165.00, '[1]'
FROM claims c WHERE c.claim_number='CLM-20250220-GG007';

INSERT OR IGNORE INTO denials (claim_id, denial_code, denial_reason, denial_date, carc_code, rarc_code)
SELECT c.id, 'PR-22', 'Missing prior authorization number for this service', '2025-03-07', '22', 'N56'
FROM claims c WHERE c.claim_number='CLM-20250220-GG007';

-- Audit logs
INSERT INTO audit_logs (entity_type, entity_id, claim_id, action, new_value, notes, created_at)
SELECT 'claim', c.id, c.id, 'created', c.status, 'Seed data', c.service_date_from
FROM claims c WHERE c.claim_number IN ('CLM-20250108-AA001','CLM-20250115-BB002','CLM-20250305-CC003','CLM-20250203-DD004','CLM-20250320-EE005','CLM-20250315-FF006','CLM-20250220-GG007');
