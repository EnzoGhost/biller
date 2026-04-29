/**
 * X12 837P EDI Generator for SometeoPR
 * 
 * Generates ANSI X12 837P (Professional) claims for submission via ImPlug or Stedi.
 * This is a pure TypeScript implementation — no Python sidecar needed.
 * 
 * Spec reference: X12 005010X222A2
 */

import type { Claim, Provider, Patient, Payer } from '../types';
import { invoke } from '@tauri-apps/api/core';

const SEP = '*';
const SEG_TERM = '~\n';
const ELEM_SEP = '*';

let _icn = parseInt(localStorage.getItem('edi_icn') ?? '1001');
function nextIcn(): string {
  _icn++;
  localStorage.setItem('edi_icn', String(_icn));
  return String(_icn).padStart(9, '0');
}

function dateYYYYMMDD(d: string | Date): string {
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10).replace(/-/g, '');
}

function dateYYMMDD(d: string | Date): string {
  return dateYYYYMMDD(d).slice(2);
}

function timeHHMM(): string {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
}

function amount(n: number | undefined | null): string {
  return (n ?? 0).toFixed(2);
}

function seg(...parts: (string | undefined | null)[]): string {
  return parts.map(p => p ?? '').join(SEP) + SEG_TERM;
}

/**
 * Build 837P transaction for a single claim.
 */
export function build837P(
  claim: Claim,
  submitterId: string = 'SUBMITTER',
  clinicName: string = 'MY CLINIC',
  clinicNpi: string = '1234567890',
  clinicEin: string = '000000000'
): string {
  const now = new Date();
  const icn = nextIcn();
  const claimId = String(claim.id);
  
  const patient = claim.patient;
  const provider = claim.provider;
  const payer = claim.payer;
  
  const providerNpi = provider?.npi ?? '0000000000';
  const providerEin = provider?.ein?.replace(/-/g, '') ?? clinicEin.replace(/-/g, '');
  const providerLastName = provider?.last_name?.toUpperCase() ?? 'PROVIDER';
  const providerFirstName = provider?.first_name?.toUpperCase() ?? '';

  const patLastName = patient?.last_name?.toUpperCase() ?? 'PATIENT';
  const patFirstName = patient?.first_name?.toUpperCase() ?? '';
  const patDob = patient?.dob ? dateYYYYMMDD(patient.dob) : '19800101';
  const patGender = patient?.gender === 'M' ? 'M' : patient?.gender === 'F' ? 'F' : 'U';
  
  const payerName = payer?.name?.toUpperCase() ?? 'PAYER';
  const payerId = payer?.stedi_payer_id ?? payer?.payer_id ?? '00000';
  
  const svDate = dateYYYYMMDD(claim.service_date_from);
  const svDateYY = dateYYMMDD(claim.service_date_from);
  const diagCodes = claim.diagnosis_codes ?? [];
  
  // Find primary insurance
  const ins = patient?.insurances?.find(i => i.is_primary) ?? patient?.insurances?.[0];
  const memberId = ins?.member_id ?? 'UNKNOWN';

  const lines: string[] = [];

  // ISA - Interchange Control Header
  lines.push(seg('ISA', '00', '          ', '00', '          ', 'ZZ', submitterId.padEnd(15), 'ZZ', payerId.padEnd(15),
    dateYYMMDD(now), timeHHMM(), '^', '00501', icn, '0', 'P', ':'));

  // GS - Functional Group Header
  lines.push(seg('GS', 'HC', submitterId, payerId, dateYYYYMMDD(now), timeHHMM(), '1', 'X', '005010X222A2'));

  // ST - Transaction Set Header
  lines.push(seg('ST', '837', '0001', '005010X222A2'));

  // BHT - Beginning of Hierarchical Transaction
  lines.push(seg('BHT', '0019', '00', claimId, dateYYYYMMDD(now), timeHHMM(), 'CH'));

  // 1000A - Submitter
  lines.push(seg('NM1', '41', '2', clinicName.toUpperCase(), '', '', '', '', '46', submitterId));
  lines.push(seg('PER', 'IC', clinicName.toUpperCase(), 'TE', '7875550000'));

  // 1000B - Receiver (Payer)
  lines.push(seg('NM1', '40', '2', payerName, '', '', '', '', '46', payerId));

  // 2000A - Billing Provider HL
  lines.push(seg('HL', '1', '', '20', '1'));
  lines.push(seg('PRV', 'BI', 'PXC', provider?.taxonomy_code ?? '152W00000X'));
  lines.push(seg('NM1', '85', '2', clinicName.toUpperCase(), '', '', '', '', 'XX', clinicNpi));
  lines.push(seg('N3', (provider?.address_line1 ?? '123 Main St').toUpperCase()));
  lines.push(seg('N4', (provider?.city ?? 'San Juan').toUpperCase(), 'PR', provider?.zip_code ?? '00901'));
  lines.push(seg('REF', 'EI', providerEin));
  // Individual rendering provider inside org
  lines.push(seg('NM1', '87', '2', clinicName.toUpperCase(), '', '', '', '', 'XX', clinicNpi));

  // 2000B - Subscriber HL
  lines.push(seg('HL', '2', '1', '22', '0'));
  lines.push(seg('SBR', 'P', '', ins?.group_number ?? '', '', '', '', '', '', 'HM'));
  lines.push(seg('NM1', 'IL', '1', patLastName, patFirstName, '', '', '', 'MI', memberId));
  lines.push(seg('N3', (patient?.address_line1 ?? '').toUpperCase()));
  lines.push(seg('N4', (patient?.city ?? 'San Juan').toUpperCase(), patient?.state ?? 'PR', patient?.zip_code ?? ''));
  lines.push(seg('DMG', 'D8', patDob, patGender));

  // Payer
  lines.push(seg('NM1', 'PR', '2', payerName, '', '', '', '', 'PI', payerId));

  // 2300 - Claim Information
  lines.push(seg('CLM', claimId, amount(claim.total_billed), '', '', `${claim.place_of_service ?? '11'}:B:1`, 'Y', 'A', 'Y', 'I'));

  if (claim.prior_auth_number) {
    lines.push(seg('REF', 'G1', claim.prior_auth_number));
  }

  // DTP - Service Dates
  lines.push(seg('DTP', '472', 'D8', svDate));

  // Diagnosis codes (2300 HI)
  if (diagCodes.length > 0) {
    const diagSegs = diagCodes.slice(0, 12).map((code, i) => (i === 0 ? `ABK:${code.replace('.', '')}` : `ABF:${code.replace('.', '')}`));
    lines.push(seg('HI', ...diagSegs));
  }

  // Rendering provider
  lines.push(seg('NM1', '82', '1', providerLastName, providerFirstName, '', '', '', 'XX', providerNpi));
  lines.push(seg('PRV', 'PE', 'PXC', provider?.taxonomy_code ?? '152W00000X'));

  // 2400 - Service Lines
  for (let i = 0; i < (claim.service_lines ?? []).length; i++) {
    const sl = claim.service_lines![i];
    const lineNum = String(i + 1);
    lines.push(seg('LX', lineNum));

    const mods = (sl.modifiers ?? []).join(':');
    const cptWithMods = sl.cpt_code + (mods ? `:${mods}` : '');
    
    lines.push(seg('SV1', `HC:${cptWithMods}`, amount(sl.billed_amount), 'UN', String(sl.units ?? 1), claim.place_of_service ?? '11', '',
      ...(sl.diagnosis_pointers ?? [1]).map(String)));
    
    lines.push(seg('DTP', '472', 'D8', sl.service_date ? dateYYYYMMDD(sl.service_date) : svDate));
  }

  // SE - Transaction Set Trailer
  const segCount = lines.filter(l => !l.startsWith('ISA') && !l.startsWith('GS') && !l.startsWith('IEA') && !l.startsWith('GE')).length + 1;
  lines.push(seg('SE', String(segCount), '0001'));

  // GE - Functional Group Trailer
  lines.push(seg('GE', '1', '1'));

  // IEA - Interchange Control Trailer
  lines.push(seg('IEA', '1', icn));

  return lines.join('');
}

/**
 * Write an 837P file to the ImPlug outbound folder.
 * Uses the Tauri `write_edi_file` command.
 */
export async function writeEdiToImPlug(claim: Claim, outboundFolder: string, submitterId?: string): Promise<string> {
  const content = build837P(claim, submitterId);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `837P_${claim.claim_number}_${date}.edi`;
  const filePath = `${outboundFolder}/${filename}`;

  await invoke('write_edi_file', { path: filePath, content });
  return filePath;
}

/**
 * Simple 835 ERA parser — extracts payment info.
 */
export interface EraPayment {
  claimNumber: string;
  paidAmount: number;
  adjustmentAmount: number;
  patientResponsibility: number;
  checkNumber: string;
  checkDate: string;
}

export function parse835(content: string): EraPayment[] {
  const segments = content.split(/[~\n]+/).map(s => s.trim()).filter(Boolean);
  const payments: EraPayment[] = [];
  let checkNumber = '';
  let checkDate = '';

  for (const seg of segments) {
    const parts = seg.split('*');
    const id = parts[0];

    if (id === 'BPR') {
      // BPR*C*amount*...*check_number*...*check_date
      checkNumber = parts[9] ?? '';
      checkDate = parts[16] ?? '';
    } else if (id === 'CLP') {
      // CLP*claim_number*status*billed*paid*patient_resp
      payments.push({
        claimNumber: parts[1] ?? '',
        paidAmount: parseFloat(parts[4] ?? '0'),
        adjustmentAmount: parseFloat(parts[3] ?? '0') - parseFloat(parts[4] ?? '0'),
        patientResponsibility: parseFloat(parts[5] ?? '0'),
        checkNumber,
        checkDate,
      });
    }
  }

  return payments;
}
